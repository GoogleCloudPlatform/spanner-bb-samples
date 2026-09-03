/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.google.spanner.cdc.loadtest;

import com.google.cloud.spanner.DatabaseClient;
import com.google.cloud.spanner.DatabaseId;
import com.google.cloud.spanner.Spanner;
import com.google.cloud.spanner.SpannerOptions;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class LoadGenerator {
  private static final Logger logger = LoggerFactory.getLogger(LoadGenerator.class);

  public enum Strategy {
    RANDOM,
    SEQUENTIAL,
    HOTSPOT,
    ATOMICITY,
    SATURATION,
    INTEGRITY,
    READ_HEAVY,
    MIXED
  }

  private final String projectId;
  private final String instanceId;
  private final String databaseId;
  private final int concurrency;
  private final Strategy strategy;
  private final int durationSeconds;

  private final AtomicLong distinctOps = new AtomicLong(0);

  public LoadGenerator(String projectId, String instanceId, String databaseId, int concurrency, Strategy strategy, int durationSeconds) {
    this.projectId = projectId;
    this.instanceId = instanceId;
    this.databaseId = databaseId;
    this.concurrency = concurrency;
    this.strategy = strategy;
    this.durationSeconds = durationSeconds;
  }

  public void run() {
    SpannerOptions options = SpannerOptions.newBuilder().setProjectId(projectId).build();
    try (Spanner spanner = options.getService()) {
      // 1. Create Client
      DatabaseId db = DatabaseId.of(projectId, instanceId, databaseId);
      DatabaseClient dbClient = spanner.getDatabaseClient(db);

      // 2. Prepare Workers
      ExecutorService executor = Executors.newFixedThreadPool(concurrency);
      List<Worker> workers = new ArrayList<>();
      
      // Shared resources for specific strategies
      String hotspotId = DataGenerator.generateId(); // for HOTSPOT
      String atomicityId1 = DataGenerator.generateId(); // for ATOMICITY
      String atomicityId2 = DataGenerator.generateId(); // for ATOMICITY
      
      // For Integrity, we need a pool of keys to churn on
      List<String> integrityKeyPool = new ArrayList<>();
      for (int i = 0; i < 100; i++) { // Pool of 100 keys
          integrityKeyPool.add(DataGenerator.generateId());
      }

      for (int i = 0; i < concurrency; i++) {
        String workerId = "worker-" + i;
        Strategy assignedStrategy = strategy;
        if (strategy == Strategy.MIXED) {
            Strategy[] all = Strategy.values();
            assignedStrategy = all[i % (all.length - 1)]; // -1 to exclude MIXED
        }
        
        Worker worker = createWorker(assignedStrategy, dbClient, workerId, hotspotId, atomicityId1, atomicityId2, integrityKeyPool);
        workers.add(worker);
      }

      // 3. Run Loop
      long endTime = System.currentTimeMillis() + (durationSeconds * 1000L);
      
      for (Worker w : workers) {
          executor.submit(() -> {
              while (System.currentTimeMillis() < endTime && !Thread.currentThread().isInterrupted()) {
                  w.call();
              }
          });
      }

      // 4. Monitor
      long lastOps = 0;
      long startTime = System.currentTimeMillis();
      while (System.currentTimeMillis() < endTime) {
        try {
          Thread.sleep(1000);
          long currentOps = distinctOps.get();
          long opsDiff = currentOps - lastOps;
          lastOps = currentOps;
          logger.info("Strategy: {}, Rate: {} ops/sec", strategy, opsDiff);
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
          break;
        }
      }

      // 5. Shutdown
      executor.shutdownNow();
      try {
        executor.awaitTermination(5, TimeUnit.SECONDS);
      } catch (InterruptedException e) {
        // ignore
      }
      logger.info("Test finished. Total Ops: {}", distinctOps.get());

    } catch (Exception e) {
      logger.error("Load test failed", e);
      throw new RuntimeException(e);
    }
  }

  private Worker createWorker(Strategy strategy, DatabaseClient dbClient, String workerId, String hotspotId, String atom1, String atom2, List<String> integrityKeyPool) {
      switch (strategy) {
          case SEQUENTIAL:
              return new Worker.SequentialWorker(dbClient, workerId, distinctOps);
          case HOTSPOT:
              return new Worker.HotspotWorker(dbClient, workerId, distinctOps, hotspotId);
          case ATOMICITY:
              return new Worker.AtomicityWorker(dbClient, workerId, distinctOps, atom1, atom2);
          case SATURATION:
              return new Worker.SaturationWorker(dbClient, workerId, distinctOps);
          case INTEGRITY:
              return new Worker.IntegrityWorker(dbClient, workerId, distinctOps, integrityKeyPool);
          case READ_HEAVY:
              return new Worker.ReadHeavyWorker(dbClient, workerId, distinctOps);
          case RANDOM:
          default:
              return new Worker.RandomWorker(dbClient, workerId, distinctOps);
      }
  }
}
