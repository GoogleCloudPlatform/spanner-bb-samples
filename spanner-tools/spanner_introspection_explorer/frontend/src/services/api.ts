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

import axios from 'axios';
import {
  DatabaseSummary,
  TableMetadata,
  TableQueryRequest,
  QueryResultPage,
  IntervalOption,
  HighRowScanQuery,
  AppConfig,
  StagingFile,
  ScatterDefaultsResponse,
  ScatterPlotResponse,
  DatabasesResponse,
  DatabaseConnection,
  CreateConnectionRequest,
  GcpProjectItem,
  GcpInstanceItem,
  GcpDatabaseItem,
  StagingFolderItem,
  TableProfilesResponse,
} from '../types';

const client = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

let cachedGcpProjects: GcpProjectItem[] | null = null;
let gcpProjectsPromise: Promise<GcpProjectItem[]> | null = null;

export const api = {
  async getAvailableDatabases(): Promise<DatabasesResponse> {
    const res = await client.get<DatabasesResponse>('/tables/meta/databases');
    return res.data;
  },

  async getAllDatabaseSummaries(): Promise<Record<string, DatabaseSummary>> {
    const res = await client.get<Record<string, DatabaseSummary>>('/tables/meta/summaries');
    return res.data;
  },

  async getDatabaseSummary(db?: string): Promise<DatabaseSummary> {
    const res = await client.get<DatabaseSummary>('/tables', {
      params: db ? { db } : undefined
    });
    return res.data;
  },

  async getTableSchema(tableName: string, db?: string): Promise<TableMetadata> {
    const res = await client.get<TableMetadata>(`/tables/${tableName}/schema`, {
      params: db ? { db } : undefined
    });
    return res.data;
  },

  async getUtcOffsets(): Promise<{ offsets: string[]; default: string; mapping: Record<string, number> }> {
    const res = await client.get('/tables/meta/offsets');
    return res.data;
  },

  async getTableColumnProfiles(tableName: string, db?: string): Promise<TableProfilesResponse> {
    const res = await client.get<TableProfilesResponse>(`/tables/${tableName}/profiles`, {
      params: db ? { db } : undefined
    });
    return res.data;
  },

  // Query & Data Engine
  async queryTable(tableName: string, req: TableQueryRequest, db?: string): Promise<QueryResultPage> {
    const res = await client.post<QueryResultPage>(`/tables/${tableName}/query`, req, {
      params: db ? { db } : undefined
    });
    return res.data;
  },

  async getTableIntervals(tableName: string, utcOffset: number = 0, db?: string): Promise<IntervalOption[]> {
    const res = await client.get<{ intervals: IntervalOption[] }>(`/tables/${tableName}/intervals`, {
      params: { utc_offset: utcOffset, ...(db ? { db } : {}) }
    });
    return res.data.intervals;
  },

  async getTableTimeline(tableName: string, utcOffset: number = 0, db?: string): Promise<{ total_intervals: number; total_records: number; buckets: { utc: string; display: string; count: number }[] }> {
    const res = await client.get(`/tables/${tableName}/timeline`, {
      params: { utc_offset: utcOffset, ...(db ? { db } : {}) }
    });
    return res.data;
  },

  async getScatterDefaults(tableName: string, db?: string): Promise<ScatterDefaultsResponse> {
    const res = await client.get<ScatterDefaultsResponse>(`/tables/${tableName}/scatter/defaults`, {
      params: db ? { db } : undefined
    });
    return res.data;
  },

  async getScatterPlotData(
    tableName: string,
    req: TableQueryRequest,
    params?: { x_col?: string; y_col?: string; size_col?: string; label_col?: string; limit?: number },
    db?: string
  ): Promise<ScatterPlotResponse> {
    const res = await client.post<ScatterPlotResponse>(`/tables/${tableName}/scatter`, req, {
      params: { ...params, ...(db ? { db } : {}) }
    });
    return res.data;
  },

  async exportTableCsv(tableName: string, req: TableQueryRequest, db?: string): Promise<void> {
    const response = await client.post(`/tables/${tableName}/export`, req, {
      params: db ? { db } : undefined,
      responseType: 'blob',
    });
    const blob = new Blob([response.data], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    // Extract filename or fallback
    const header = response.headers['content-disposition'];
    let filename = `${tableName}_export.csv`;
    if (header && header.includes('filename=')) {
      const match = header.match(/filename="?([^"]+)"?/);
      if (match && match[1]) filename = match[1];
    }
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },

  // AI DBRE Agents
  async getSchemaPreview(): Promise<{ exists: boolean; total_chars: number; preview: string; is_configured: boolean }> {
    const res = await client.get('/agent/schema/preview');
    return res.data;
  },

  async getHighRowScanQueries(): Promise<{ count: number; queries: HighRowScanQuery[] }> {
    const res = await client.get<{ count: number; queries: HighRowScanQuery[] }>('/agent/query-profile/queries');
    return res.data;
  },

  // Pipeline & Config
  async getStagingFiles(db?: string): Promise<StagingFile[]> {
    const res = await client.get<{ files: StagingFile[] }>('/pipeline/staging', {
      params: db ? { db } : undefined
    });
    return res.data.files;
  },

  async getConfig(): Promise<AppConfig> {
    const res = await client.get<AppConfig>('/pipeline/config');
    return res.data;
  },

  async updateConfig(config: Partial<AppConfig>): Promise<void> {
    await client.post('/pipeline/config', config);
  },

  // Database Connections Management
  async getConnections(): Promise<DatabaseConnection[]> {
    const res = await client.get<DatabaseConnection[]>('/connections');
    return res.data;
  },

  async createConnection(req: CreateConnectionRequest): Promise<DatabaseConnection> {
    const res = await client.post<DatabaseConnection>('/connections', req);
    return res.data;
  },

  async getConnection(id: string): Promise<DatabaseConnection> {
    const res = await client.get<DatabaseConnection>(`/connections/${encodeURIComponent(id)}`);
    return res.data;
  },

  async deleteConnection(id: string, deleteDuckdb = true, deleteStaging = false): Promise<void> {
    await client.delete(`/connections/${encodeURIComponent(id)}`, {
      params: { delete_duckdb: deleteDuckdb, delete_staging: deleteStaging }
    });
  },

  async syncConnection(id: string): Promise<any> {
    const res = await client.post(`/connections/${encodeURIComponent(id)}/sync`);
    return res.data;
  },

  async getStagingFolders(): Promise<StagingFolderItem[]> {
    const res = await client.get<StagingFolderItem[]>('/connections/staging-folders');
    return res.data;
  },

  // GCP Discovery & Connectivity
  async getGcpProjects(refresh = false): Promise<GcpProjectItem[]> {
    if (!refresh && cachedGcpProjects) {
      return cachedGcpProjects;
    }
    if (!refresh && gcpProjectsPromise) {
      return gcpProjectsPromise;
    }
    gcpProjectsPromise = client.get<GcpProjectItem[]>('/gcp/projects', {
      params: { refresh }
    }).then((res) => {
      cachedGcpProjects = res.data;
      gcpProjectsPromise = null;
      return res.data;
    }).catch((err) => {
      gcpProjectsPromise = null;
      throw err;
    });
    return gcpProjectsPromise;
  },

  async getGcpInstances(projectId: string, refresh = false): Promise<GcpInstanceItem[]> {
    const res = await client.get<GcpInstanceItem[]>('/gcp/instances', {
      params: { project_id: projectId, refresh }
    });
    return res.data;
  },

  async getGcpDatabases(projectId: string, instanceId: string, refresh = false): Promise<GcpDatabaseItem[]> {
    const res = await client.get<GcpDatabaseItem[]>('/gcp/databases', {
      params: { project_id: projectId, instance_id: instanceId, refresh }
    });
    return res.data;
  },

  async testGcpConnection(req: { project_id: string; instance_id: string; database_id: string; dialect?: string }): Promise<{ success: boolean; message: string }> {
    const res = await client.post<{ success: boolean; message: string }>('/gcp/test', req);
    return res.data;
  },
};

