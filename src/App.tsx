import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { TopBar } from './components/TopBar';
import { RoleToggleStrip } from './components/RoleToggleStrip';
import { OverviewPage } from './components/OverviewPage';
import {
  ClinicianWorkspace,
  type ClinicianSubTab,
  type DraftTaskInput,
} from './components/ClinicianWorkspace';
import { ClientPortal } from './components/ClientPortal';
import { ResourcesLibrary } from './components/ResourcesLibrary';
import type {
  ActiveTab,
  HomeworkAssignment,
  ResourceItem,
  TherapyModality,
  UserRole,
  WorkspacePayload,
} from './types/care';

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [role, setRole] = useState<UserRole>('clinician');
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [clinicianSubTab, setClinicianSubTab] =
    useState<ClinicianSubTab>('generator');
  const [activeClientToken, setActiveClientToken] = useState<string>('');
  const [incomingTemplate, setIncomingTemplate] = useState<ResourceItem | null>(
    null
  );
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 2600);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchWorkspace() {
      try {
        const res = await fetch('/api/workspace');
        if (!res.ok) {
          throw new Error('Unable to load clinical workspace.');
        }
        const data = (await res.json()) as WorkspacePayload;
        if (cancelled) return;
        setWorkspace(data);

        // Check URL query parameter for direct client weblink access
        const params = new URLSearchParams(window.location.search);
        const urlToken = params.get('clientLink');
        if (urlToken) {
          const matchedAsg = data.assignments.find(
            (a) => a.uniqueToken === urlToken
          );
          if (matchedAsg) {
            setActiveClientToken(matchedAsg.uniqueToken);
            setSelectedClientId(matchedAsg.clientId);
            setRole('client');
            setActiveTab('client');
            setLoading(false);
            return;
          }
        }

        if (data.clients.length > 0) {
          const firstClient = data.clients[0];
          setSelectedClientId(firstClient.id);
          const firstAsg =
            data.assignments.find(
              (a) => a.clientId === firstClient.id && a.status === 'pushed'
            ) || data.assignments[0];
          if (firstAsg) {
            setActiveClientToken(firstAsg.uniqueToken);
          }
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : 'Failed to load workspace.'
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchWorkspace();
    return () => {
      cancelled = true;
    };
  }, []);

  const syncUrlClientToken = (token: string | null) => {
    try {
      const url = new URL(window.location.href);
      if (token) {
        url.searchParams.set('clientLink', token);
      } else {
        url.searchParams.delete('clientLink');
      }
      window.history.replaceState({}, '', url.toString());
    } catch {
      // Ignore history errors in restricted frames
    }
  };

  const handleNavigate = (tab: ActiveTab) => {
    setActiveTab(tab);
    if (tab === 'clinician') {
      setRole('clinician');
      syncUrlClientToken(null);
    } else if (tab === 'client') {
      setRole('client');
      if (activeClientToken) {
        syncUrlClientToken(activeClientToken);
      }
    } else {
      syncUrlClientToken(null);
    }
  };

  const handleToggleRole = (nextRole: UserRole) => {
    setRole(nextRole);
    if (nextRole === 'clinician') {
      setActiveTab('clinician');
      syncUrlClientToken(null);
    } else {
      // Switch to active client's latest pushed or current assignment
      const clientAsg =
        workspace?.assignments.find(
          (a) => a.clientId === selectedClientId && a.status === 'pushed'
        ) ||
        workspace?.assignments.find((a) => a.clientId === selectedClientId) ||
        workspace?.assignments[0];
      if (clientAsg) {
        setActiveClientToken(clientAsg.uniqueToken);
        syncUrlClientToken(clientAsg.uniqueToken);
      }
      setActiveTab('client');
    }
  };

  const handleSelectClient = (clientId: string) => {
    setSelectedClientId(clientId);
    const matched =
      workspace?.assignments.find(
        (a) => a.clientId === clientId && a.status === 'pushed'
      ) || workspace?.assignments.find((a) => a.clientId === clientId);
    if (matched) {
      setActiveClientToken(matched.uniqueToken);
    }
  };

  const handleCopyLink = (token: string) => {
    const shareUrl = `${window.location.origin}/?clientLink=${token}`;
    navigator.clipboard?.writeText(shareUrl).catch(() => {});
    showToast(`Copied private client link (?clientLink=${token})`);
  };

  const handleOpenClientLink = (token: string) => {
    const matched = workspace?.assignments.find((a) => a.uniqueToken === token);
    if (matched) {
      setSelectedClientId(matched.clientId);
    }
    setActiveClientToken(token);
    setRole('client');
    setActiveTab('client');
    syncUrlClientToken(token);
  };

  const handleCreateAssignment = async (payload: {
    clientId: string;
    title: string;
    modality: TherapyModality;
    clinicalRationale: string;
    walkthroughNotes: string;
    estimatedMinutes: number;
    status: 'walkthrough' | 'pushed';
    tasks: DraftTaskInput[];
  }): Promise<HomeworkAssignment> => {
    const res = await fetch('/api/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error('Could not save worksheet.');
    }
    const created = (await res.json()) as HomeworkAssignment;
    setWorkspace((prev) =>
      prev
        ? { ...prev, assignments: [created, ...prev.assignments] }
        : prev
    );
    setActiveClientToken(created.uniqueToken);
    showToast(
      payload.status === 'pushed'
        ? 'Worksheet pushed to client link'
        : 'Worksheet saved for walkthrough'
    );
    return created;
  };

  const handleUpdateAssignment = async (
    assignmentId: string,
    updates: Partial<HomeworkAssignment>
  ): Promise<HomeworkAssignment> => {
    const res = await fetch(`/api/assignments/${assignmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      throw new Error('Could not update worksheet.');
    }
    const updated = (await res.json()) as HomeworkAssignment;
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            assignments: prev.assignments.map((a) =>
              a.id === updated.id ? updated : a
            ),
          }
        : prev
    );
    if (updates.status === 'pushed') {
      showToast(`Pushed to client (?clientLink=${updated.uniqueToken})`);
    }
    return updated;
  };

  const handleToggleTask = async (
    assignmentId: string,
    taskId: string,
    completed?: boolean,
    reflectionResponse?: string
  ): Promise<HomeworkAssignment> => {
    const res = await fetch(
      `/api/assignments/${assignmentId}/tasks/${taskId}/toggle`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed, reflectionResponse }),
      }
    );
    if (!res.ok) {
      throw new Error('Could not save task update.');
    }
    const updated = (await res.json()) as HomeworkAssignment;
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            assignments: prev.assignments.map((a) =>
              a.id === updated.id ? updated : a
            ),
          }
        : prev
    );
    return updated;
  };

  const handleSubmitAssignment = async (
    assignmentId: string,
    payload: {
      moodRating: number;
      difficultyRating: number;
      overallReflection: string;
    }
  ) => {
    const res = await fetch(`/api/assignments/${assignmentId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error('Could not submit homework.');
    }
    const { assignment: updatedAsg, client: updatedClient } =
      (await res.json()) as {
        assignment: HomeworkAssignment;
        client?: WorkspacePayload['clients'][number];
      };

    setWorkspace((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        assignments: prev.assignments.map((a) =>
          a.id === updatedAsg.id ? updatedAsg : a
        ),
        clients: updatedClient
          ? prev.clients.map((c) =>
              c.id === updatedClient.id ? updatedClient : c
            )
          : prev.clients,
      };
    });
    showToast('Homework submitted to your clinician');
  };

  const handleSaveClinicianReview = async (
    assignmentId: string,
    clinicianFeedback: string
  ): Promise<HomeworkAssignment> => {
    const res = await fetch(
      `/api/assignments/${assignmentId}/clinician-review`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clinicianFeedback }),
      }
    );
    if (!res.ok) {
      throw new Error('Could not save review note.');
    }
    const updated = (await res.json()) as HomeworkAssignment;
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            assignments: prev.assignments.map((a) =>
              a.id === updated.id ? updated : a
            ),
          }
        : prev
    );
    showToast('Clinician note shared with client');
    return updated;
  };

  const handleUseTemplate = (resource: ResourceItem) => {
    setIncomingTemplate(resource);
    setRole('clinician');
    setClinicianSubTab('generator');
    setActiveTab('clinician');
    syncUrlClientToken(null);
    showToast(`Loaded "${resource.title}" into Generator`);
  };

  const selectedClient = workspace?.clients.find(
    (c) => c.id === selectedClientId
  );
  const activeAssignment =
    workspace?.assignments.find((a) => a.uniqueToken === activeClientToken) ||
    workspace?.assignments.find((a) => a.clientId === selectedClientId);

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF9F6] text-[#151B2E]">
      <TopBar
        activeTab={activeTab}
        onNavigate={handleNavigate}
        onStartNewWorksheet={() => {
          setRole('clinician');
          setClinicianSubTab('generator');
          setActiveTab('clinician');
          syncUrlClientToken(null);
        }}
      />

      {workspace && (
        <RoleToggleStrip
          role={role}
          onToggleRole={handleToggleRole}
          selectedClient={selectedClient}
          activeAssignment={activeAssignment}
          onCopyLink={handleCopyLink}
        />
      )}

      <main className="flex-1">
        {loading ? (
          <div className="max-w-[1360px] mx-auto px-6 py-24 flex flex-col items-center justify-center gap-3 text-sm text-[#57534E]">
            <Loader2 className="w-6 h-6 animate-spin text-[#2045C8]" aria-hidden="true" />
            <span>Loading clinical workspace...</span>
          </div>
        ) : loadError || !workspace ? (
          <div className="max-w-lg mx-auto px-6 py-24 text-center">
            <p className="text-sm font-medium text-[#991B1B]">
              {loadError || 'Workspace unavailable.'}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 text-xs font-medium bg-[#151B2E] text-white rounded-lg"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            {activeTab === 'overview' && (
              <OverviewPage
                clinician={workspace.clinician}
                clients={workspace.clients}
                assignments={workspace.assignments}
                onNavigate={handleNavigate}
                onStartNewWorksheet={() => {
                  setRole('clinician');
                  setClinicianSubTab('generator');
                  setActiveTab('clinician');
                }}
                onOpenSampleClientLink={handleOpenClientLink}
              />
            )}

            {activeTab === 'clinician' && (
              <ClinicianWorkspace
                clients={workspace.clients}
                assignments={workspace.assignments}
                selectedClientId={selectedClientId}
                onSelectClient={handleSelectClient}
                activeSubTab={clinicianSubTab}
                onChangeSubTab={setClinicianSubTab}
                incomingTemplate={incomingTemplate}
                onClearIncomingTemplate={() => setIncomingTemplate(null)}
                onCreateAssignment={handleCreateAssignment}
                onUpdateAssignment={handleUpdateAssignment}
                onSaveClinicianReview={handleSaveClinicianReview}
                onOpenClientLink={handleOpenClientLink}
                onCopyLink={handleCopyLink}
              />
            )}

            {activeTab === 'client' && (
              <ClientPortal
                clinician={workspace.clinician}
                clients={workspace.clients}
                assignments={workspace.assignments}
                activeToken={activeClientToken}
                onSelectToken={(token) => {
                  setActiveClientToken(token);
                  const matched = workspace.assignments.find(
                    (a) => a.uniqueToken === token
                  );
                  if (matched) {
                    setSelectedClientId(matched.clientId);
                  }
                  syncUrlClientToken(token);
                }}
                onToggleTask={handleToggleTask}
                onSubmitAssignment={handleSubmitAssignment}
              />
            )}

            {activeTab === 'resources' && (
              <ResourcesLibrary
                resources={workspace.resources}
                onUseTemplate={handleUseTemplate}
              />
            )}
          </>
        )}
      </main>

      {/* Quiet Clinical Footer */}
      <footer className="border-t border-[#E6E2DA] bg-white">
        <div className="max-w-[1360px] mx-auto px-6 py-6 flex flex-wrap items-center justify-between gap-4 text-xs text-[#57534E]">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-display font-semibold text-[#151B2E]">
              Heidi Care
            </span>
            <span aria-hidden="true">·</span>
            <span>Between-session therapy continuity · Singapore PDPA aligned</span>
          </div>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => handleNavigate('overview')}
              className="hover:text-[#151B2E]"
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => handleNavigate('clinician')}
              className="hover:text-[#151B2E]"
            >
              Clinician
            </button>
            <button
              type="button"
              onClick={() => handleNavigate('client')}
              className="hover:text-[#151B2E]"
            >
              Client Portal
            </button>
            <button
              type="button"
              onClick={() => handleNavigate('resources')}
              className="hover:text-[#151B2E]"
            >
              Resources
            </button>
          </div>
        </div>
      </footer>

      {/* Subtle Toast Confirmation */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 bg-[#151B2E] text-white text-xs font-medium px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2"
        >
          <Check className="w-3.5 h-3.5 text-[#86EFAC]" aria-hidden="true" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
