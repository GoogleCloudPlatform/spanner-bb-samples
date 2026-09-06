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

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Tab,
  Box,
  Typography,
  TextField,
  Button,
  CircularProgress,
  Alert,
  Autocomplete,
  createFilterOptions,
  IconButton,
  Tooltip,
  Chip,
} from '@mui/material';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import StorageIcon from '@mui/icons-material/Storage';

import {
  ConnectionType,
  CreateConnectionRequest,
  DatabaseConnection,
  GcpDatabaseItem,
  GcpInstanceItem,
  GcpProjectItem,
  SqlDialect,
  StagingFolderItem,
} from '../types';
import { api } from '../services/api';
import { gcpPalette } from '../theme';

interface AddConnectionModalProps {
  open: boolean;
  onClose: () => void;
  onConnectionCreated: (newConn: DatabaseConnection) => void;
}

export const AddConnectionModal: React.FC<AddConnectionModalProps> = ({
  open,
  onClose,
  onConnectionCreated,
}) => {
  const [tabIndex, setTabIndex] = useState<number>(0);

  // Common Form Fields
  const [connectionName, setConnectionName] = useState<string>('');
  const [dialect, setDialect] = useState<SqlDialect>('GOOGLE_STANDARD_SQL');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Option A: GCP Spanner State
  const [projects, setProjects] = useState<GcpProjectItem[]>([]);
  const [loadingProjects, setLoadingProjects] = useState<boolean>(false);
  const [selectedProject, setSelectedProject] = useState<GcpProjectItem | null>(null);

  const [instances, setInstances] = useState<GcpInstanceItem[]>([]);
  const [loadingInstances, setLoadingInstances] = useState<boolean>(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('');

  const [databases, setDatabases] = useState<GcpDatabaseItem[]>([]);
  const [loadingDatabases, setLoadingDatabases] = useState<boolean>(false);
  const [selectedDatabaseId, setSelectedDatabaseId] = useState<string>('');

  const [testingConnection, setTestingConnection] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Option B: Local Staging State
  const [stagingFolders, setStagingFolders] = useState<StagingFolderItem[]>([]);
  const [loadingStaging, setLoadingStaging] = useState<boolean>(false);
  const [selectedStagingPath, setSelectedStagingPath] = useState<string>('');
  const [autoIngest, setAutoIngest] = useState<boolean>(true);

  // Load Initial Data when Modal Opens
  useEffect(() => {
    if (open) {
      setError(null);
      setTestResult(null);
      setConnectionName('');
      setSelectedProject(null);
      setSelectedInstanceId('');
      setSelectedDatabaseId('');
      setInstances([]);
      setDatabases([]);
      setSelectedStagingPath('');
      setDialect('GOOGLE_STANDARD_SQL');
      loadProjects(false);
      loadStagingFolders();
    }
  }, [open]);

  const loadProjects = async (refresh = false) => {
    if (projects.length === 0 || refresh) {
      setLoadingProjects(true);
    }
    try {
      const res = await api.getGcpProjects(refresh);
      setProjects(res);
    } catch (err: any) {
      console.warn('Could not load GCP projects', err);
    } finally {
      setLoadingProjects(false);
    }
  };

  const loadStagingFolders = async () => {
    setLoadingStaging(true);
    try {
      const res = await api.getStagingFolders();
      setStagingFolders(res);
    } catch (err: any) {
      console.warn('Could not load staging folders', err);
    } finally {
      setLoadingStaging(false);
    }
  };

  // Load instances when project changes
  const handleSelectProject = async (project: GcpProjectItem | null, refresh = false) => {
    setSelectedProject(project);
    setSelectedInstanceId('');
    setSelectedDatabaseId('');
    setInstances([]);
    setDatabases([]);
    setTestResult(null);

    if (!project || !project.project_id) return;

    setLoadingInstances(true);
    try {
      const res = await api.getGcpInstances(project.project_id, refresh);
      setInstances(res);
    } catch (err: any) {
      console.warn('Failed to load instances', err);
    } finally {
      setLoadingInstances(false);
    }
  };

  // Select an instance explicitly
  const handleSelectInstance = (instanceId: string, refresh = false) => {
    setSelectedInstanceId(instanceId);
    setSelectedDatabaseId('');
    setDatabases([]);
    setTestResult(null);
    if (selectedProject?.project_id && instanceId) {
      loadDatabases(selectedProject.project_id, instanceId, refresh);
    }
  };

  // Select a database explicitly
  const handleSelectDatabase = (databaseId: string) => {
    setSelectedDatabaseId(databaseId);
    setTestResult(null);
    const dbObj = databases.find((d) => d.database_id === databaseId);
    if (dbObj && dbObj.dialect) {
      setDialect(dbObj.dialect);
    }
    if (!connectionName || connectionName.includes('(')) {
      setConnectionName(`${databaseId} (${selectedInstanceId || 'spanner'})`);
    }
  };

  // Load databases when instance changes
  const loadDatabases = async (projectId: string, instanceId: string, refresh = false) => {
    if (!projectId || !instanceId) return;
    setLoadingDatabases(true);
    setSelectedDatabaseId('');
    setDatabases([]);
    setTestResult(null);
    try {
      const res = await api.getGcpDatabases(projectId, instanceId, refresh);
      setDatabases(res);
    } catch (err: any) {
      console.warn('Failed to load databases', err);
    } finally {
      setLoadingDatabases(false);
    }
  };

  const handleTestConnection = async () => {
    if (!selectedProject || !selectedInstanceId || !selectedDatabaseId) return;
    setTestingConnection(true);
    setTestResult(null);
    try {
      const res = await api.testGcpConnection({
        project_id: selectedProject.project_id,
        instance_id: selectedInstanceId,
        database_id: selectedDatabaseId,
        dialect,
      });
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.response?.data?.detail || err.message || 'Connection test failed',
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSave = async () => {
    setError(null);
    const connType: ConnectionType = tabIndex === 0 ? 'gcp' : 'local_staging';

    if (connType === 'gcp') {
      if (!selectedProject) {
        setError('Please select or enter a GCP Project ID.');
        return;
      }
      if (!selectedInstanceId) {
        setError('Please select or enter a Spanner Instance ID.');
        return;
      }
      if (!selectedDatabaseId) {
        setError('Please select or enter a Spanner Database ID.');
        return;
      }
    } else {
      if (!selectedStagingPath) {
        setError('Please select a local staging directory.');
        return;
      }
    }

    const finalName = connectionName.trim() || (connType === 'gcp' ? selectedDatabaseId : selectedStagingPath.split('/').pop() || 'New Database');

    setLoading(true);
    try {
      const payload: CreateConnectionRequest = {
        name: finalName,
        type: connType,
        dialect,
        project_id: connType === 'gcp' ? selectedProject?.project_id : undefined,
        instance_id: connType === 'gcp' ? selectedInstanceId : undefined,
        database_id: connType === 'gcp' ? selectedDatabaseId : undefined,
        staging_path: connType === 'local_staging' ? selectedStagingPath : undefined,
        auto_ingest: autoIngest,
      };

      const newConn = await api.createConnection(payload);
      setLoading(false);
      onConnectionCreated(newConn);
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to register connection');
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1 }}>
        <StorageIcon sx={{ color: gcpPalette.primary.main }} />
        <Typography variant="h2" sx={{ fontSize: '1.2rem', fontWeight: 600 }}>
          Register Database Connection
        </Typography>
      </DialogTitle>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
        <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)}>
          <Tab
            icon={<CloudQueueIcon fontSize="small" />}
            iconPosition="start"
            label="GCP Cloud Spanner"
            sx={{ textTransform: 'none', fontWeight: 600 }}
          />
          <Tab
            icon={<FolderOpenIcon fontSize="small" />}
            iconPosition="start"
            label="Local Staging Directory"
            sx={{ textTransform: 'none', fontWeight: 600 }}
          />
        </Tabs>
      </Box>

      <DialogContent sx={{ pt: 3 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {/* Tab 0: GCP Cloud Spanner */}
        {tabIndex === 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <Typography variant="body2" sx={{ color: gcpPalette.neutral.textSecondary }}>
              Connect directly to a Cloud Spanner database instance. Project IDs and instances are cached locally for fast selection.
            </Typography>

            {/* Connection Display Name */}
            <TextField
              label="Connection Display Name"
              size="small"
              fullWidth
              placeholder="e.g. Production Orders EU"
              value={connectionName}
              onChange={(e) => setConnectionName(e.target.value)}
            />

            {/* GCP Project ID with Cache & Refresh */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Autocomplete
                size="small"
                fullWidth
                options={projects}
                filterOptions={createFilterOptions({ limit: 100 })}
                getOptionLabel={(p) => (typeof p === 'string' ? p : `${p.project_id}${p.name && p.name !== p.project_id ? ` (${p.name})` : ''}`)}
                value={selectedProject}
                onChange={(_, val) => {
                  if (typeof val === 'string') {
                    handleSelectProject({ project_id: val, name: val }, false);
                  } else {
                    handleSelectProject(val, false);
                  }
                }}
                onInputChange={(_, val, reason) => {
                  if (reason === 'input') {
                    const match = projects.find((p) => p.project_id === val);
                    handleSelectProject(match || (val ? { project_id: val, name: val } : null), false);
                  }
                }}
                loading={loadingProjects}
                freeSolo
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={`GCP Project ID ${projects.length > 0 ? `(${projects.length.toLocaleString()} cached)` : ''}`}
                    placeholder="Search or enter Project ID..."
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {loadingProjects ? <CircularProgress size={16} /> : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                  />
                )}
              />
              <Tooltip title="Refresh Project List from GCP">
                <IconButton
                  size="small"
                  onClick={() => loadProjects(true)}
                  disabled={loadingProjects}
                  sx={{ border: `1px solid ${gcpPalette.neutral.border}` }}
                >
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>

            {/* Spanner Instance ID */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Autocomplete
                size="small"
                fullWidth
                freeSolo
                disabled={!selectedProject || loadingInstances}
                options={instances.map((inst) => inst.instance_id)}
                value={selectedInstanceId}
                onChange={(_, val) => {
                  const instId = typeof val === 'string' ? val : '';
                  handleSelectInstance(instId, false);
                }}
                onInputChange={(_, val, reason) => {
                  if (reason === 'input') {
                    handleSelectInstance(val, false);
                  }
                }}
                loading={loadingInstances}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Spanner Instance ID"
                    placeholder="Select or enter Instance ID (e.g. prod-instance)..."
                    helperText={
                      !loadingInstances && selectedProject && instances.length === 0
                        ? 'No instances found via list API. You can enter an Instance ID manually.'
                        : undefined
                    }
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {loadingInstances ? <CircularProgress size={16} /> : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                  />
                )}
              />
              <Tooltip title="Refresh Instances">
                <IconButton
                  size="small"
                  onClick={() => selectedProject && handleSelectProject(selectedProject, true)}
                  disabled={!selectedProject || loadingInstances}
                  sx={{ border: `1px solid ${gcpPalette.neutral.border}` }}
                >
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>

            {/* Spanner Database ID */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Autocomplete
                size="small"
                fullWidth
                freeSolo
                disabled={!selectedInstanceId || loadingDatabases}
                options={databases.map((db) => db.database_id)}
                value={selectedDatabaseId}
                onChange={(_, val) => {
                  const dbId = typeof val === 'string' ? val : '';
                  handleSelectDatabase(dbId);
                }}
                onInputChange={(_, val, reason) => {
                  if (reason === 'input') {
                    handleSelectDatabase(val);
                  }
                }}
                loading={loadingDatabases}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Database ID"
                    placeholder="Select or enter Database ID..."
                    helperText={
                      !loadingDatabases && selectedInstanceId && databases.length === 0
                        ? 'No databases found on this instance. You can enter a Database ID manually.'
                        : undefined
                    }
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {loadingDatabases ? <CircularProgress size={16} /> : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                  />
                )}
              />
              <Tooltip title="Refresh Databases">
                <IconButton
                  size="small"
                  onClick={() => selectedProject && selectedInstanceId && loadDatabases(selectedProject.project_id, selectedInstanceId, true)}
                  disabled={!selectedInstanceId || loadingDatabases}
                  sx={{ border: `1px solid ${gcpPalette.neutral.border}` }}
                >
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>

            {/* Auto-Detected SQL Dialect */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.5 }}>
              <Typography variant="body2" sx={{ color: gcpPalette.neutral.textSecondary, fontWeight: 500 }}>
                SQL Dialect:
              </Typography>
              {selectedDatabaseId ? (
                <Chip
                  label={dialect === 'POSTGRESQL' ? 'PostgreSQL' : 'Google Standard SQL'}
                  size="small"
                  sx={{
                    fontWeight: 600,
                    backgroundColor: dialect === 'POSTGRESQL' ? '#e8f0fe' : gcpPalette.primary.light,
                    color: gcpPalette.primary.main,
                  }}
                />
              ) : (
                <Typography variant="caption" sx={{ color: gcpPalette.neutral.textSecondary, fontStyle: 'italic' }}>
                  (Auto-detected upon selecting database)
                </Typography>
              )}
            </Box>

            {/* Test Connection Button */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={testingConnection ? <CircularProgress size={14} /> : <FlashOnIcon />}
                onClick={handleTestConnection}
                disabled={testingConnection || !selectedProject || !selectedInstanceId || !selectedDatabaseId}
              >
                {testingConnection ? 'Testing...' : 'Test Connection'}
              </Button>
              {testResult && (
                <Typography variant="body2" sx={{ color: testResult.success ? 'success.main' : 'error.main', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {testResult.success ? <CheckCircleIcon fontSize="small" /> : '❌'} {testResult.message}
                </Typography>
              )}
            </Box>
          </Box>
        )}

        {/* Tab 1: Local Staging Directory */}
        {tabIndex === 1 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <Typography variant="body2" sx={{ color: gcpPalette.neutral.textSecondary }}>
              Register a local staging folder (e.g. <code>staging/sample-staging-folder/</code>) containing exported Spanner CSV files and schema.
            </Typography>

            {/* Connection Display Name */}
            <TextField
              label="Database Display Name"
              size="small"
              fullWidth
              placeholder="e.g. Production Orders Staging"
              value={connectionName}
              onChange={(e) => setConnectionName(e.target.value)}
            />

            {/* Staging Directory Selector */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Autocomplete
                size="small"
                fullWidth
                freeSolo
                options={stagingFolders.map((f) => f.path)}
                value={selectedStagingPath}
                onChange={(_, val) => {
                  const p = typeof val === 'string' ? val : '';
                  setSelectedStagingPath(p);
                  const folder = stagingFolders.find((f) => f.path === p);
                  if (folder && !connectionName) {
                    setConnectionName(folder.name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
                  }
                }}
                onInputChange={(_, val, reason) => {
                  if (reason === 'input') {
                    setSelectedStagingPath(val);
                    const folderName = val.split('/').filter(Boolean).pop();
                    if (folderName && !connectionName) {
                      setConnectionName(folderName.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
                    }
                  }
                }}
                loading={loadingStaging}
                renderOption={(props, option) => {
                  const folder = stagingFolders.find((f) => f.path === option);
                  return (
                    <li {...props} key={option}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                        <span>{option}</span>
                        {folder && (
                          <Chip
                            size="small"
                            label={`${folder.csv_count} CSVs (${folder.total_size_mb} MB)`}
                            sx={{ height: 20, fontSize: '0.7rem' }}
                          />
                        )}
                      </Box>
                    </li>
                  );
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Staging Folder Directory"
                    placeholder="Select existing folder or enter path (e.g. staging/my-export)..."
                    helperText={
                      !loadingStaging && stagingFolders.length === 0
                        ? 'No subdirectories currently found in staging/. You can enter a directory path manually.'
                        : 'Select a discovered folder or enter a custom path'
                    }
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {loadingStaging ? <CircularProgress size={16} /> : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                  />
                )}
              />
              <Tooltip title="Scan Staging Folders">
                <IconButton
                  size="small"
                  onClick={loadStagingFolders}
                  disabled={loadingStaging}
                  sx={{ border: `1px solid ${gcpPalette.neutral.border}` }}
                >
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <StorageIcon />}
        >
          {loading ? 'Registering...' : 'Save Database Connection'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
