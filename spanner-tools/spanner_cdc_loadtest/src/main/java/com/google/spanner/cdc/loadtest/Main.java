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

import picocli.CommandLine;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import java.util.concurrent.Callable;

@Command(name = "spanner-loadtest", mixinStandardHelpOptions = true, version = "1.0",
         description = "Generates load on Cloud Spanner for CDC testing.")
public class Main implements Callable<Integer> {

    @Option(names = {"-p", "--project"}, required = true, description = "Google Cloud Project ID")
    private String projectId;

    @Option(names = {"-i", "--instance"}, required = true, description = "Spanner Instance ID")
    private String instanceId;

    @Option(names = {"-d", "--database"}, required = true, description = "Spanner Database ID")
    private String databaseId;

    @Option(names = {"-c", "--concurrency"}, description = "Number of concurrent threads (default: 10)")
    private int concurrency = 10;
    
    @Option(names = {"--duration"}, description = "Duration of test in seconds (default: 60)")
    private int duration = 60;
    
    @Option(names = {"-s", "--strategy"}, description = "Load strategy: ${COMPLETION-CANDIDATES} (default: RANDOM)")
    private LoadGenerator.Strategy strategy = LoadGenerator.Strategy.RANDOM;

    public static void main(String[] args) {
        int exitCode = new CommandLine(new Main()).execute(args);
        System.exit(exitCode);
    }

    @Override
    public Integer call() throws Exception {
        System.out.printf("Starting load test on %s/%s/%s with %d threads, strategy %s for %d seconds...%n",
            projectId, instanceId, databaseId, concurrency, strategy, duration);
            
        LoadGenerator generator = new LoadGenerator(projectId, instanceId, databaseId, concurrency, strategy, duration);
        generator.run();
        
        return 0;
    }
}
