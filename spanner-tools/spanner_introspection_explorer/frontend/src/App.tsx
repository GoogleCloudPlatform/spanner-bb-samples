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
import { Box, ThemeProvider, CssBaseline, CircularProgress } from '@mui/material';
import { theme, gcpPalette } from './theme';
import { AppHeader } from './components/AppHeader';
import { AppNavigation } from './components/AppNavigation';
import { DashboardView } from './views/DashboardView';
import { TableExplorerView } from './views/TableExplorerView';
import { SchemaScannerView } from './views/SchemaScannerView';
import { QueryProfileView } from './views/QueryProfileView';
import { PipelineView } from './views/PipelineView';
import { SettingsModal } from './views/SettingsModal';
import { ConnectionsView } from './views/ConnectionsView';

import { api } from './services/api';
import { DatabaseSummary, DatabaseItem } from './types';

export const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<'dashboard' | 'table' | 'schema_scanner' | 'query_profile' | 'pipeline' | 'connections'>('dashboard');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  // Multi-Database Selection & Summaries
  const [availableDatabases, setAvailableDatabases] = useState<DatabaseItem[]>([]);
  const [summaries, setSummaries] = useState<Record<string, DatabaseSummary>>({});
  const [selectedDatabase, setSelectedDatabase] = useState<string>('');

  // Timezone Offset
  const [utcOffsets, setUtcOffsets] = useState<string[]>(['UTC +00:00']);
  const [utcOffsetMapping, setUtcOffsetMapping] = useState<Record<string, number>>({ 'UTC +00:00': 0 });
  const [selectedUtcOffset, setSelectedUtcOffset] = useState<string>('UTC +00:00');

  // App Configuration
  const [hasAiKey, setHasAiKey] = useState<boolean>(false);
  const [loadingSummary, setLoadingSummary] = useState(true);

  // Settings Modal
  const [settingsOpen, setSettingsOpen] = useState(false);

  const loadData = async (targetDb?: string) => {
    setLoadingSummary(true);
    try {
      const [dbsData, allSummaries, offsetsData, configData] = await Promise.all([
        api.getAvailableDatabases(),
        api.getAllDatabaseSummaries().catch(() => ({} as Record<string, DatabaseSummary>)),
        api.getUtcOffsets(),
        api.getConfig(),
      ]);

      const dbsList = dbsData.databases || [];
      setAvailableDatabases(dbsList);
      setSummaries(allSummaries);
      setUtcOffsets(offsetsData.offsets);
      setUtcOffsetMapping(offsetsData.mapping);
      setHasAiKey(Boolean(configData.google_api_key_configured));

      if (dbsList.length === 0) {
        setSelectedDatabase('');
        setLoadingSummary(false);
        return;
      }

      let activeDb = targetDb || selectedDatabase;
      if (!activeDb || !dbsList.some((d) => d.id === activeDb)) {
        activeDb = dbsList[0].id;
      }
      setSelectedDatabase(activeDb);
    } catch (err) {
      console.error('Failed to initialize app', err);
    } finally {
      setLoadingSummary(false);
    }
  };

  useEffect(() => {
    loadData();
    // Preload full GCP project list in background so modal opens instantly
    api.getGcpProjects(false).catch(() => {});
  }, []);

  const handleSelectView = (databaseId: string, view: string, table?: string) => {
    if (databaseId) {
      setSelectedDatabase(databaseId);
    }

    if ((view === 'schema_scanner' || view === 'query_profile') && !hasAiKey) {
      setCurrentView('dashboard');
      return;
    }

    if (view === 'table' && table) {
      setSelectedTable(table);
      setCurrentView('table');
    } else {
      setSelectedTable(null);
      setCurrentView(view as any);
    }
  };

  const handleSelectTableFromDashboard = (tableName: string) => {
    setSelectedTable(tableName);
    setCurrentView('table');
  };

  const numericUtcOffset = utcOffsetMapping[selectedUtcOffset] || 0;
  const activeDbObj = availableDatabases.find((d) => d.id === selectedDatabase);
  const activeDbSummary = selectedDatabase ? summaries[selectedDatabase] || null : null;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', backgroundColor: gcpPalette.neutral.background, overflow: 'hidden' }}>
        {/* Top GCP Header Bar */}
        <AppHeader
          selectedDatabaseName={activeDbObj?.name || selectedDatabase}
          selectedTable={currentView === 'table' ? selectedTable : null}
          selectedUtcOffset={selectedUtcOffset}
          utcOffsets={utcOffsets}
          onUtcOffsetChange={setSelectedUtcOffset}
          onOpenSettings={() => setSettingsOpen(true)}
          onNavigateToConnections={() => setCurrentView('connections')}
        />

        {/* Body Layout: Tree Sidebar + Main Content */}
        <Box sx={{ display: 'flex', flex: 1, height: 'calc(100vh - 48px)', position: 'relative', overflow: 'hidden' }}>
          <AppNavigation
            availableDatabases={availableDatabases}
            selectedDatabase={selectedDatabase}
            currentView={currentView}
            selectedTable={selectedTable}
            summaries={summaries}
            hasAiKey={hasAiKey}
            onSelectView={handleSelectView}
            onRegisterDatabase={() => setCurrentView('connections')}
          />

          <Box
            component="main"
            sx={{
              flexGrow: 1,
              p: 3,
              width: 'calc(100% - 290px)',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              overflowX: 'hidden',
            }}
          >
            {loadingSummary && availableDatabases.length > 0 && !activeDbSummary ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
                <CircularProgress size={48} />
              </Box>
            ) : (
              <>
                {currentView === 'dashboard' && (
                  <DashboardView
                    dbSummary={activeDbSummary}
                    hasAiKey={hasAiKey}
                    onSelectTable={handleSelectTableFromDashboard}
                    onNavigate={(v) => handleSelectView(selectedDatabase, v)}
                  />
                )}

                {currentView === 'table' && selectedTable && (
                  <TableExplorerView
                    tableName={selectedTable}
                    utcOffset={numericUtcOffset}
                    utcOffsetLabel={selectedUtcOffset}
                    db={selectedDatabase}
                    onNavigateHome={() => handleSelectView(selectedDatabase, 'dashboard')}
                  />
                )}

                {currentView === 'schema_scanner' && hasAiKey && <SchemaScannerView />}

                {currentView === 'query_profile' && hasAiKey && <QueryProfileView />}

                {currentView === 'pipeline' && (
                  <PipelineView
                    selectedDatabase={selectedDatabase}
                    onRefreshData={() => loadData(selectedDatabase)}
                  />
                )}

                {currentView === 'connections' && (
                  <ConnectionsView
                    onSelectDatabase={(dbId) => {
                      setSelectedDatabase(dbId);
                      loadData(dbId);
                    }}
                    onOpenExplorer={(dbId) => {
                      setSelectedDatabase(dbId);
                      setCurrentView('dashboard');
                      loadData(dbId);
                    }}
                    onConnectionsChanged={() => loadData()}
                  />
                )}
              </>
            )}
          </Box>
        </Box>

        {/* Global Settings Modal */}
        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onConfigSaved={loadData}
        />
      </Box>
    </ThemeProvider>
  );
};
