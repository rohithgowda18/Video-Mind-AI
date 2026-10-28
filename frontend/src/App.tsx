import React, { useRef, useState } from 'react';
import { 
  Play, 
  Sparkles, 
  MessageSquare, 
  FileText, 
  Lightbulb, 
  Search, 
  ExternalLink, 
  Clock, 
  CheckCircle2, 
  ArrowRight,
  Shield,
  Database,
  Zap,
  Loader2,
  AlertCircle,
  Network,
  HelpCircle,
  Check,
  X,
  Gauge,
  FolderPlus, Pencil, Trash2, Download, Upload
} from 'lucide-react';
import { 
  loadVideo, 
  askQuestion, 
  summarizeVideo, 
  getKeyTakeaways,
  getMindmap,
  getQuiz,
  getIndexedVideos
} from './services/api';

declare global {
  interface Window {
    mermaid?: any;
  }
}

export default function App() {
  type LibraryVideo = { id: string; title: string; status: 'ready' | 'indexing' | 'unavailable' };
  type LibraryFolder = { id: string; name: string; videos: LibraryVideo[]; completedVideoIds: string[] };
  type DialogState = {
    kind: 'input' | 'confirm';
    title: string;
    message: string;
    value?: string;
    placeholder?: string;
    confirmLabel: string;
    onConfirm: (value: string) => void;
  };
  const readFolders = (): LibraryFolder[] => {
    try {
      const raw = localStorage.getItem('video-mind-folders');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed
        .filter((folder) => folder && typeof folder.id === 'string' && typeof folder.name === 'string' && Array.isArray(folder.videos))
        .map((folder) => ({
          id: folder.id,
          name: folder.name,
          completedVideoIds: Array.isArray(folder.completedVideoIds)
            ? folder.completedVideoIds.filter((id: unknown): id is string => typeof id === 'string')
            : [],
          videos: folder.videos.filter((video: unknown) => {
            const item = video as Partial<LibraryVideo>;
            return typeof item.id === 'string' && typeof item.title === 'string';
          }).map((video: Partial<LibraryVideo>) => ({
            id: video.id as string,
            title: video.title as string,
            status: (video.status === 'indexing' || video.status === 'unavailable' ? video.status : 'ready') as LibraryVideo['status'],
          })),
        })) : [];
    } catch {
      return [];
    }
  };
  const [currentPage, setCurrentPage] = useState<'landing' | 'dashboard' | 'workspace' | 'insights'>('landing');
  const [videoUrl, setVideoUrl] = useState('');
  const [loadedVideoId, setLoadedVideoId] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'qa' | 'summary' | 'takeaways' | 'mindmap' | 'quiz'>('qa');
  const [playerSeekTime, setPlayerSeekTime] = useState<number>(0);

  // Loading and Error States
  const [isLoadingVideo, setIsLoadingVideo] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [activeIndexedVideos, setActiveIndexedVideos] = useState<string[]>([]);
  const [folders, setFolders] = useState<LibraryFolder[]>(readFolders);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [chatScope, setChatScope] = useState<'video' | 'folder'>('video');
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogValue, setDialogValue] = useState('');
  const [toast, setToast] = useState<{ kind: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [indexingFolderId, setIndexingFolderId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) || null;
  const activeContextIds = chatScope === 'folder' && selectedFolder
    ? selectedFolder.videos.map((video) => video.id)
    : loadedVideoId ? [loadedVideoId] : [];
  const activeContextTitles = Object.fromEntries(
    (selectedFolder?.videos || []).map((video) => [video.id, video.title])
  );

  const persistFolders = (next: LibraryFolder[]) => {
    setFolders(next);
    try {
      localStorage.setItem('video-mind-folders', JSON.stringify(next));
    } catch {
      setToast({ kind: 'error', message: 'Your browser could not save the library. Check storage permissions and try again.' });
    }
  };

  const showToast = (kind: 'success' | 'error' | 'info', message: string) => {
    setToast({ kind, message });
    window.setTimeout(() => setToast((current) => current?.message === message ? null : current), 4500);
  };

  const exportLibrary = () => {
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      folders,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `video-mind-library-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast('success', 'Library backup downloaded.');
  };

  const importLibrary = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const candidate = parsed && typeof parsed === 'object' && 'folders' in parsed
        ? (parsed as { folders: unknown }).folders
        : parsed;
      if (!Array.isArray(candidate)) throw new Error('The backup does not contain a valid folder list.');
      const imported = candidate.filter((folder): folder is { id: string; name: string; videos: unknown[] } => {
        return !!folder && typeof folder === 'object'
          && typeof (folder as { id?: unknown }).id === 'string'
          && typeof (folder as { name?: unknown }).name === 'string'
          && Array.isArray((folder as { videos?: unknown }).videos);
      }).map((folder) => ({
        id: folder.id,
        name: folder.name.trim(),
        completedVideoIds: [],
        videos: folder.videos.filter((video): video is LibraryVideo => {
          if (!video || typeof video !== 'object') return false;
          const item = video as Partial<LibraryVideo>;
          return typeof item.id === 'string' && typeof item.title === 'string';
        }).map((video) => ({
          id: video.id,
          title: video.title,
          status: (video.status === 'indexing' || video.status === 'unavailable' ? video.status : 'ready') as LibraryVideo['status'],
        })),
      }));
      if (imported.length === 0) throw new Error('No valid folders were found in this backup.');
      const merged = [...folders];
      imported.forEach((folder) => {
        const existing = merged.find((item) => item.name.toLowerCase() === folder.name.toLowerCase());
        if (existing) {
          const videos = [...existing.videos];
          folder.videos.forEach((video) => {
            if (!videos.some((item) => item.id === video.id)) videos.push(video);
          });
          existing.videos = videos;
        } else {
          merged.push(folder);
        }
      });
      persistFolders(merged);
      showToast('success', `${imported.length} folder${imported.length === 1 ? '' : 's'} imported.`);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'This library backup could not be imported.');
    }
  };

  const openInputDialog = (
    title: string,
    message: string,
    initialValue: string,
    placeholder: string,
    confirmLabel: string,
    onConfirm: (value: string) => void,
  ) => {
    setDialog({ kind: 'input', title, message, value: initialValue, placeholder, confirmLabel, onConfirm });
    setDialogValue(initialValue);
  };

  const openConfirmDialog = (
    title: string,
    message: string,
    confirmLabel: string,
    onConfirm: () => void,
  ) => {
    setDialog({ kind: 'confirm', title, message, confirmLabel, onConfirm: () => onConfirm() });
  };

  // Auto-fetch stored video IDs when visiting dashboard
  React.useEffect(() => {
    if (currentPage === 'dashboard') {
      getIndexedVideos()
        .then((res) => {
          if (res && res.videos) setActiveIndexedVideos(res.videos);
        })
        .catch(() => {});
      // Upgrade legacy ID-only paths when their library folder is known.
      void Promise.all(
        folders.flatMap((folder) =>
          folder.videos.map((video) => loadVideo(video.id, folder.name).catch(() => null))
        )
      );
    }
  }, [currentPage, folders]);


  // Q&A State
  const [question, setQuestion] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{
    sender: 'user' | 'ai';
    text: string;
    sources?: Array<{ video_id: string; title: string; formatted_timestamp: string; timestamp: number; text: string; url: string }>;
    metrics?: { retrieval_ms: number; generation_ms: number; total_ms: number; chunks_retrieved: number };
  }>>([]);

  // Summary State
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Takeaways State
  const [takeawaysList, setTakeawaysList] = useState<string[]>([]);
  const [isGeneratingTakeaways, setIsGeneratingTakeaways] = useState(false);
  const [takeawaysError, setTakeawaysError] = useState<string | null>(null);

  // Mindmap State
  const [mindmapCode, setMindmapCode] = useState<string | null>(null);
  const [isGeneratingMindmap, setIsGeneratingMindmap] = useState(false);
  const [mindmapError, setMindmapError] = useState<string | null>(null);

  // Quiz State
  const [quizList, setQuizList] = useState<Array<{
    question: string;
    options: string[];
    correct_index: number;
    explanation: string;
  }>>([]);
  const [userAnswers, setUserAnswers] = useState<{ [key: number]: number }>({});
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);

  const resetStateForNewVideo = () => {
    setPlayerSeekTime(0);
    setChatMessages([]);
    setQuestion('');
    setSummaryText(null);
    setSummaryError(null);
    setTakeawaysList([]);
    setTakeawaysError(null);
    setMindmapCode(null);
    setMindmapError(null);
    setQuizList([]);
    setQuizError(null);
    setUserAnswers({});
    setActiveTab('qa');
  };

  const createFolder = () => {
    openInputDialog('Create folder', 'Give this learning folder a clear subject name.', '', 'e.g. Java, DBMS, Operating Systems', 'Create folder', (rawName) => {
      const name = rawName.trim();
      if (!name) {
        showToast('error', 'Folder name cannot be empty.');
        return;
      }
      if (folders.some((folder) => folder.name.toLowerCase() === name.toLowerCase())) {
        showToast('error', 'A folder with this name already exists.');
        return;
      }
      persistFolders([...folders, { id: `${Date.now()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, videos: [], completedVideoIds: [] }]);
      showToast('success', `"${name}" folder created.`);
    });
  };

  const renameFolder = (folder: LibraryFolder) => {
    openInputDialog('Rename folder', 'Choose a new name for this learning folder.', folder.name, 'Folder name', 'Save name', (rawName) => {
      const name = rawName.trim();
      if (!name) {
        showToast('error', 'Folder name cannot be empty.');
        return;
      }
      if (folders.some((item) => item.id !== folder.id && item.name.toLowerCase() === name.toLowerCase())) {
        showToast('error', 'A folder with this name already exists.');
        return;
      }
      persistFolders(folders.map((item) => item.id === folder.id ? { ...item, name } : item));
      showToast('success', 'Folder renamed.');
    });
  };

  const deleteFolder = (folder: LibraryFolder) => {
    openConfirmDialog('Delete folder?', `"${folder.name}" will be removed from this browser. Its videos and FAISS indexes will remain available.`, 'Delete folder', () => {
      persistFolders(folders.filter((item) => item.id !== folder.id));
      if (selectedFolderId === folder.id) {
        setSelectedFolderId(null);
        setChatScope('video');
        resetStateForNewVideo();
      }
      showToast('success', 'Folder deleted.');
    });
  };

  const addVideoToFolder = async (folder: LibraryFolder) => {
    openInputDialog('Add video', `Add a YouTube URL or video ID to "${folder.name}". It will be indexed before it becomes searchable.`, '', 'https://youtube.com/watch?v=...', 'Index video', async (rawUrl) => {
      const url = rawUrl.trim();
      if (!url) {
        showToast('error', 'Enter a YouTube URL or video ID.');
        return;
      }
      setVideoError(null);
      setIndexingFolderId(folder.id);
      setIsLoadingVideo(true);
      try {
        const res = await loadVideo(url, folder.name);
        if (folder.videos.some((video) => video.id === res.video_id)) {
          showToast('error', 'This video is already in the folder.');
          return;
        }
        const video = { id: res.video_id, title: res.title || `YouTube Video (${res.video_id})`, status: 'ready' as const };
        persistFolders(folders.map((item) => item.id === folder.id ? { ...item, videos: [...item.videos, video] } : item));
        showToast('success', 'Video indexed and added to the folder.');
      } catch (err: any) {
        showToast('error', err.message || 'Unable to index this video.');
      } finally {
        setIndexingFolderId(null);
        setIsLoadingVideo(false);
      }
    });
  };

  const openFolder = (folder: LibraryFolder) => {
    setSelectedFolderId(folder.id);
    setChatScope('folder');
    resetStateForNewVideo();
    const first = folder.videos.find((video) => !folder.completedVideoIds.includes(video.id)) || folder.videos[0];
    setLoadedVideoId(first?.id || null);
    setVideoTitle(first?.title || null);
    setCurrentPage('workspace');
    if (folder.videos.length > 0) {
      void Promise.all(folder.videos.map((video) => loadVideo(video.id, folder.name).catch(() => null)));
    }
  };

  const toggleVideoComplete = (folder: LibraryFolder, videoId: string) => {
    const completedVideoIds = folder.completedVideoIds.includes(videoId)
      ? folder.completedVideoIds.filter((id) => id !== videoId)
      : [...folder.completedVideoIds, videoId];
    persistFolders(folders.map((item) => item.id === folder.id ? { ...item, completedVideoIds } : item));
  };

  const handleLoadVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoUrl.trim()) {
      setVideoError('Please enter a YouTube URL or Video ID.');
      return;
    }

    setIsLoadingVideo(true);
    setVideoError(null);

    try {
      const res = await loadVideo(videoUrl.trim());
      resetStateForNewVideo();
      setLoadedVideoId(res.video_id);
      setVideoTitle(res.title || `YouTube Video (${res.video_id})`);
      setChatMessages([
        {
          sender: 'ai',
          text: `Video loaded successfully! You can now ask questions grounded in this video's transcript, view the mindmap, or take a quiz.`,
        }
      ]);
      setCurrentPage('workspace');
    } catch (err: any) {
      setVideoError(err.message || 'Unable to process this video.');
    } finally {
      setIsLoadingVideo(false);
    }
  };


  const handleAskQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || activeContextIds.length === 0 || isAsking) return;

    const userQ = question.trim();
    setQuestion('');
    
    // Build conversation history for multi-turn context
    const historyPayload = chatMessages
      .filter((m) => m.sender === 'user' || m.sender === 'ai')
      .slice(-4)
      .map((m) => ({
        role: m.sender === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.text,
      }));

    setChatMessages((prev) => [...prev, { sender: 'user', text: userQ }]);
    setIsAsking(true);

    try {
      const res = await askQuestion(activeContextIds, userQ, historyPayload, activeContextTitles);
      setChatMessages((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: res.answer,
          sources: res.sources,
          metrics: res.metrics,
        }
      ]);
    } catch (err: any) {
      setChatMessages((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: `⚠️ ${err.message || 'AI service is temporarily unavailable.'}`,
        }
      ]);
    } finally {
      setIsAsking(false);
    }
  };

  const handleFetchSummary = async () => {
    if (activeContextIds.length === 0 || isSummarizing) return;
    setIsSummarizing(true);
    setSummaryError(null);

    try {
      const res = await summarizeVideo(activeContextIds, activeContextTitles);
      setSummaryText(res.summary);
    } catch (err: any) {
      setSummaryError(err.message || 'Unable to generate summary.');
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleFetchTakeaways = async () => {
    if (activeContextIds.length === 0 || isGeneratingTakeaways) return;
    setIsGeneratingTakeaways(true);
    setTakeawaysError(null);

    try {
      const res = await getKeyTakeaways(activeContextIds, activeContextTitles);
      setTakeawaysList(res.takeaways || []);
    } catch (err: any) {
      setTakeawaysError(err.message || 'Unable to generate key takeaways.');
    } finally {
      setIsGeneratingTakeaways(false);
    }
  };

  const handleFetchMindmap = async () => {
    if (activeContextIds.length === 0 || isGeneratingMindmap) return;
    setIsGeneratingMindmap(true);
    setMindmapError(null);

    try {
      const res = await getMindmap(activeContextIds, activeContextTitles);
      setMindmapCode(res.mindmap);
      setTimeout(() => {
        if (window.mermaid) {
          try {
            window.mermaid.initialize({ startOnLoad: false, theme: 'dark' });
            window.mermaid.run();
          } catch (e) {
            console.error('Mermaid render error:', e);
          }
        }
      }, 100);
    } catch (err: any) {
      setMindmapError(err.message || 'Unable to generate concept map.');
    } finally {
      setIsGeneratingMindmap(false);
    }
  };

  const handleFetchQuiz = async () => {
    if (activeContextIds.length === 0 || isGeneratingQuiz) return;
    setIsGeneratingQuiz(true);
    setQuizError(null);
    setUserAnswers({});

    try {
      const res = await getQuiz(activeContextIds, activeContextTitles);
      setQuizList(res.quiz || []);
    } catch (err: any) {
      setQuizError(err.message || 'Unable to generate quiz.');
    } finally {
      setIsGeneratingQuiz(false);
    }
  };

  const removeVideoFromFolder = (folder: LibraryFolder, video: LibraryVideo) => {
    openConfirmDialog(
      'Remove video?',
      `"${video.title}" will be removed from "${folder.name}". Its FAISS index will not be deleted.`,
      'Remove video',
      () => {
        persistFolders(folders.map((item) => item.id === folder.id
          ? { ...item, videos: item.videos.filter((entry) => entry.id !== video.id) }
          : item));
        if (selectedFolderId === folder.id && loadedVideoId === video.id) {
          setLoadedVideoId(folder.videos.find((entry) => entry.id !== video.id)?.id || null);
          setVideoTitle(null);
          setChatMessages([]);
        }
        showToast('success', 'Video removed from the folder. Its index was kept.');
      },
    );
  };


  return (
    <div className="min-h-screen bg-[#080B12] text-[#F8FAFC] font-sans flex flex-col antialiased">
      {toast && (
        <div className={`fixed right-5 top-5 z-[90] max-w-sm rounded-xl border px-4 py-3 shadow-2xl flex items-start gap-3 ${
          toast.kind === 'error'
            ? 'bg-red-950 border-red-500/50 text-red-100'
            : toast.kind === 'success'
              ? 'bg-emerald-950 border-emerald-500/50 text-emerald-100'
              : 'bg-sky-950 border-sky-500/50 text-sky-100'
        }`} role="status">
          {toast.kind === 'error' ? <AlertCircle className="w-5 h-5 mt-0.5 text-red-300" /> : <CheckCircle2 className="w-5 h-5 mt-0.5 text-emerald-300" />}
          <span className="text-sm font-semibold leading-relaxed">{toast.message}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast(null)} className="ml-2 text-slate-300 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      )}

      {dialog && (
        <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-labelledby="library-dialog-title">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              dialog.onConfirm(dialog.kind === 'input' ? dialogValue : '');
              setDialog(null);
            }}
            className="w-full max-w-md rounded-2xl bg-[#111827] border border-slate-700 shadow-2xl p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="library-dialog-title" className="text-lg font-bold text-white">{dialog.title}</h2>
                <p className="text-sm text-slate-300 mt-2 leading-relaxed">{dialog.message}</p>
              </div>
              <button type="button" aria-label="Close dialog" onClick={() => setDialog(null)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            {dialog.kind === 'input' && (
              <input
                autoFocus
                value={dialogValue}
                onChange={(event) => setDialogValue(event.target.value)}
                placeholder={dialog.placeholder}
                className="mt-5 w-full rounded-xl bg-slate-950 border border-slate-700 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
              />
            )}
            <div className="flex justify-end gap-3 mt-6">
              <button type="button" onClick={() => setDialog(null)} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-300 hover:bg-slate-800">Cancel</button>
              <button type="submit" className={`px-4 py-2 rounded-lg text-sm font-bold ${dialog.kind === 'confirm' ? 'bg-red-500 text-white hover:bg-red-400' : 'bg-sky-400 text-slate-950 hover:bg-sky-300'}`}>
                {dialog.confirmLabel}
              </button>
            </div>
          </form>
        </div>
      )}
      {/* Navigation Header */}
      <header className="sticky top-0 z-50 glass-panel border-b border-slate-700/50 px-6 py-4 flex items-center justify-between shadow-xl">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setCurrentPage('landing')}>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-400 to-purple-500 flex items-center justify-center text-slate-950 font-bold shadow-lg shadow-sky-500/20">
            <Sparkles className="w-5 h-5 text-slate-950" />
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight text-gradient">Video-Mind AI</span>
            <span className="block text-[11px] font-mono font-semibold uppercase tracking-widest text-sky-300">FastAPI & Gemini Platform</span>
          </div>
        </div>

        <nav className="flex items-center gap-2 bg-[#0F1524] p-1.5 rounded-xl border border-slate-700/60">
          <button 
            onClick={() => setCurrentPage('landing')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${currentPage === 'landing' ? 'bg-sky-500/20 text-sky-200 border border-sky-400/40 shadow-sm' : 'text-slate-300 hover:text-white hover:bg-slate-800/50'}`}
          >
            Landing
          </button>
          <button 
            onClick={() => setCurrentPage('dashboard')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${currentPage === 'dashboard' ? 'bg-sky-500/20 text-sky-200 border border-sky-400/40 shadow-sm' : 'text-slate-300 hover:text-white hover:bg-slate-800/50'}`}
          >
            Dashboard
          </button>
          <button 
            onClick={() => setCurrentPage('workspace')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${currentPage === 'workspace' ? 'bg-sky-500/20 text-sky-200 border border-sky-400/40 shadow-sm' : 'text-slate-300 hover:text-white hover:bg-slate-800/50'}`}
          >
            Workspace
          </button>
          <button 
            onClick={() => setCurrentPage('insights')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${currentPage === 'insights' ? 'bg-sky-500/20 text-sky-200 border border-sky-400/40 shadow-sm' : 'text-slate-300 hover:text-white hover:bg-slate-800/50'}`}
          >
            Insights & Summary
          </button>
        </nav>
      </header>

      {/* Main Content Area */}
      <main className="flex-1">
        {/* ================= LANDING PAGE ================= */}
        {currentPage === 'landing' && (
          <div className="relative overflow-hidden">
            {/* Hero Glow */}
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-sky-500/15 blur-[130px] rounded-full pointer-events-none" />

            <div className="max-w-6xl mx-auto px-6 py-20 text-center relative z-10">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-purple-950/60 border border-purple-400/40 text-purple-200 text-xs font-mono font-semibold mb-6 shadow-sm">
                <Sparkles className="w-4 h-4 text-purple-300" /> Next-Gen YouTube Video Intelligence
              </div>

              <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight text-white mb-6 leading-tight">
                Understand Any YouTube Video <br />
                <span className="text-gradient">Responses Grounded in Transcript Context</span>
              </h1>

              <p className="text-lg text-slate-300 max-w-2xl mx-auto mb-10 leading-relaxed font-normal">
                Instantly extract answers, key takeaways, and structured summaries with timestamped transcript sources using Gemini 2.5 Flash & FAISS vector search.
              </p>

              {/* URL Input Hero Form */}
              <form onSubmit={handleLoadVideo} className="max-w-2xl mx-auto mb-16">
                <div className="glass-panel p-2.5 rounded-2xl flex items-center gap-2 border border-sky-400/40 shadow-2xl shadow-sky-500/10">
                  <div className="pl-4 text-sky-400">
                    <Search className="w-5 h-5" />
                  </div>
                  <input
                    type="text"
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    placeholder="Enter YouTube URL or Video ID (e.g. Gfr50f6ZBvo)..."
                    className="flex-1 bg-transparent px-2 py-3 text-white placeholder:text-slate-400 focus:outline-none text-sm font-medium"
                  />
                  <button
                    type="submit"
                    disabled={isLoadingVideo}
                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-sky-400 to-blue-600 text-slate-950 font-bold text-sm hover:opacity-95 transition-all flex items-center gap-2 shadow-lg shadow-sky-500/30 disabled:opacity-50 cursor-pointer"
                  >
                    {isLoadingVideo ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-slate-950" /> Analyzing...
                      </>
                    ) : (
                      <>
                        Analyze Video <ArrowRight className="w-4 h-4 text-slate-950" />
                      </>
                    )}
                  </button>
                </div>

                {videoError && (
                  <div className="mt-4 p-3.5 rounded-xl bg-red-950/80 border border-red-500/50 text-red-200 text-sm font-semibold flex items-center justify-center gap-2 max-w-2xl mx-auto shadow-md">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" /> {videoError}
                  </div>
                )}
              </form>

              {/* Feature Highlights */}
              <div className="grid md:grid-cols-3 gap-6 text-left max-w-5xl mx-auto">
                <div className="glass-panel p-6 rounded-2xl border border-slate-700/60 shadow-md">
                  <div className="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-300 flex items-center justify-center mb-4 border border-sky-400/30">
                    <Clock className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">Timestamped Sources</h3>
                  <p className="text-sm text-slate-300 leading-relaxed">Direct links to exact moments in the YouTube video to verify AI generated answers instantly.</p>
                </div>

                <div className="glass-panel p-6 rounded-2xl border border-slate-700/60 shadow-md">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-300 flex items-center justify-center mb-4 border border-purple-400/30">
                    <Database className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">Persistent FAISS Search</h3>
                  <p className="text-sm text-slate-300 leading-relaxed">FAISS index persists on disk per video ID, providing instant query performance without re-embedding.</p>
                </div>

                <div className="glass-panel p-6 rounded-2xl border border-slate-700/60 shadow-md">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center mb-4 border border-emerald-400/30">
                    <Shield className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">Grounded Responses</h3>
                  <p className="text-sm text-slate-300 leading-relaxed">Gemini 2.5 Flash answers strictly from transcript context to ensure response accuracy.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= DASHBOARD PAGE ================= */}
        {currentPage === 'dashboard' && (
          <div className="max-w-6xl mx-auto px-6 py-10">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-3xl font-bold text-white mb-1">Project Dashboard</h1>
                <p className="text-sm text-slate-300 font-medium">Overview of active video indexes and processing pipelines</p>
              </div>
              <button 
                onClick={() => setCurrentPage('workspace')}
                className="px-4 py-2.5 rounded-xl bg-sky-400 text-slate-950 font-bold text-sm flex items-center gap-2 hover:bg-sky-300 transition-all shadow-lg shadow-sky-500/20 cursor-pointer"
              >
                <Zap className="w-4 h-4 text-slate-950" /> Open Workspace
              </button>
            </div>

            <div className="glass-panel rounded-2xl p-6 border border-slate-700/60 shadow-xl mb-8">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold text-white">Knowledge Library</h2>
                  <p className="text-xs text-slate-400 mt-1">Organize videos by subject and track what you have finished. Data stays in this browser.</p>
                </div>
                <div className="flex items-center gap-2">
                  <input ref={importInputRef} type="file" accept="application/json,.json" onChange={importLibrary} className="hidden" />
                  <button onClick={() => importInputRef.current?.click()} className="px-3 py-2 rounded-lg bg-slate-800 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-2 hover:bg-slate-700">
                    <Upload className="w-4 h-4" /> Import
                  </button>
                  <button onClick={exportLibrary} disabled={folders.length === 0} className="px-3 py-2 rounded-lg bg-slate-800 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-2 hover:bg-slate-700 disabled:opacity-40">
                    <Download className="w-4 h-4" /> Export
                  </button>
                  <button onClick={createFolder} className="px-3 py-2 rounded-lg bg-purple-500/20 text-purple-200 border border-purple-400/30 text-xs font-semibold flex items-center gap-2">
                    <FolderPlus className="w-4 h-4" /> New Folder
                  </button>
                </div>
              </div>
              {folders.length === 0 ? (
                <p className="text-sm text-slate-400 py-4">No folders yet. Create one for a subject such as Java or DBMS.</p>
              ) : (
                <div className="grid md:grid-cols-2 gap-3">
                  {folders.map((folder) => (
                    <div key={folder.id} className="rounded-xl bg-slate-900/70 border border-slate-700 p-4">
                      <div className="flex items-center justify-between">
                        <button onClick={() => openFolder(folder)} className="text-left flex-1">
                          <span className="font-bold text-white">{folder.name}</span>
                          <span className="block text-xs text-slate-400 mt-1">{folder.videos.length} video{folder.videos.length === 1 ? '' : 's'} · {folder.completedVideoIds.filter((id) => folder.videos.some((video) => video.id === id)).length}/{folder.videos.length} completed</span>
                        </button>
                        <div className="flex gap-1">
                          <button aria-label={`Add video to ${folder.name}`} disabled={indexingFolderId === folder.id} onClick={() => addVideoToFolder(folder)} className="p-2 text-sky-300 hover:bg-sky-500/10 rounded disabled:opacity-50">
                            {indexingFolderId === folder.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
                          </button>
                          <button aria-label={`Rename ${folder.name}`} onClick={() => renameFolder(folder)} className="p-2 text-slate-300 hover:bg-slate-700 rounded"><Pencil className="w-4 h-4" /></button>
                          <button aria-label={`Delete ${folder.name}`} onClick={() => deleteFolder(folder)} className="p-2 text-red-300 hover:bg-red-500/10 rounded"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                      {folder.videos.length === 0 && <p className="text-xs text-amber-300 mt-3">Empty folder - add a video to use folder AI.</p>}
                      {folder.videos.map((video) => (
                        <div key={video.id} className="mt-3 flex items-center justify-between text-xs border-t border-slate-800 pt-2">
                          <button
                            aria-label={`${folder.completedVideoIds.includes(video.id) ? 'Mark incomplete' : 'Mark complete'}: ${video.title}`}
                            onClick={() => toggleVideoComplete(folder, video.id)}
                            className={`mr-2 w-5 h-5 rounded border flex items-center justify-center ${folder.completedVideoIds.includes(video.id) ? 'bg-emerald-500 border-emerald-400 text-slate-950' : 'border-slate-600 text-transparent hover:border-emerald-400'}`}
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <span className={`truncate ${folder.completedVideoIds.includes(video.id) ? 'text-slate-500 line-through' : 'text-slate-300'}`}>{video.title}</span>
                          <span className={`ml-2 whitespace-nowrap ${video.status === 'ready' ? 'text-emerald-300' : 'text-amber-300'}`}>
                            {video.status === 'ready' ? 'Ready' : video.status}
                          </span>
                          <button onClick={() => removeVideoFromFolder(folder, video)} className="text-red-300 ml-2 hover:text-red-200">Remove</button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Metrics */}
            <div className="grid md:grid-cols-4 gap-4 mb-8">
              <div className="glass-panel p-5 rounded-xl border border-slate-700/60">
                <span className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold">Backend API</span>
                <p className="text-sm font-mono text-sky-300 font-bold mt-2 truncate">
                  {import.meta.env.VITE_API_URL || 'http://localhost:8000'}
                </p>
              </div>
              <div className="glass-panel p-5 rounded-xl border border-slate-700/60">
                <span className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold">FAISS Indexes</span>
                <p className="text-2xl font-bold text-sky-300 mt-1">Local Store</p>
              </div>
              <div className="glass-panel p-5 rounded-xl border border-slate-700/60">
                <span className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold">Embedding Model</span>
                <p className="text-sm font-mono text-purple-300 font-semibold mt-3">all-MiniLM-L6-v2</p>
              </div>
              <div className="glass-panel p-5 rounded-xl border border-slate-700/60">
                <span className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold">LLM Engine</span>
                <p className="text-sm font-mono text-emerald-300 font-semibold mt-3">Gemini 2.5 Flash</p>
              </div>
            </div>

            {/* Video Indexes List */}
            <div className="glass-panel rounded-2xl p-6 border border-slate-700/60 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-white">Active Video Indexes in Storage</h2>
                <span className="text-xs font-mono text-slate-400">
                  {activeIndexedVideos.length > 0 ? `${activeIndexedVideos.length} Saved on Disk` : 'Checking disk...'}
                </span>
              </div>
              <div className="divide-y divide-slate-700/50">
                {(activeIndexedVideos.length > 0
                  ? activeIndexedVideos.map((id) => ({
                      id,
                      title: id === 'Gfr50f6ZBvo' ? 'DeepMind AI Research Breakdown' : id === 'dQw4w9WgXcQ' ? 'Neural Networks and Self-Attention' : `Cached Video (${id})`,
                      status: 'Ready on Disk'
                    }))
                  : [
                      { id: 'Gfr50f6ZBvo', title: 'DeepMind AI Research Breakdown', status: 'Ready' },
                      { id: 'dQw4w9WgXcQ', title: 'Neural Networks and Self-Attention Explained', status: 'Ready' }
                    ]
                ).map((item) => (
                  <div key={item.id} className="py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-slate-800/90 border border-slate-700 flex items-center justify-center text-sky-300 font-mono text-xs">
                        <Play className="w-5 h-5 text-sky-400" />
                      </div>
                      <div>
                        <h4 className="text-base font-bold text-white">{item.title}</h4>
                        <span className="text-xs text-slate-300 font-mono">ID: {item.id} • Persisted in faiss_indexes/</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs font-mono font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> {item.status}
                      </span>
                      <button 
                        onClick={async () => {
                          setIsLoadingVideo(true);
                          try {
                            const res = await loadVideo(item.id);
                            resetStateForNewVideo();
                            setLoadedVideoId(res.video_id);
                            setVideoTitle(res.title || `YouTube Video (${res.video_id})`);
                            setChatMessages([
                              {
                                sender: 'ai',
                                text: `Video loaded successfully! You can now ask questions grounded in this video's transcript, view the mindmap, or take a quiz.`,
                              }
                            ]);
                            setCurrentPage('workspace');
                          } catch (err: any) {
                            setVideoError(err.message);
                          } finally {
                            setIsLoadingVideo(false);
                          }
                        }}
                        className="px-3.5 py-1.5 rounded-lg bg-sky-500/20 text-sky-200 border border-sky-400/30 text-xs font-semibold hover:bg-sky-500/30 transition-all cursor-pointer"
                      >
                        Load Video
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ================= WORKSPACE PAGE ================= */}
        {currentPage === 'workspace' && (
          <div className="max-w-6xl mx-auto px-6 py-8">
            {!loadedVideoId ? (
              <div className="glass-panel p-10 rounded-2xl border border-slate-700/60 text-center max-w-xl mx-auto my-12 space-y-4 shadow-xl">
                <div className="w-12 h-12 rounded-xl bg-sky-500/20 text-sky-300 flex items-center justify-center mx-auto border border-sky-400/30">
                  <Play className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-white">{selectedFolder ? `${selectedFolder.name} is empty` : 'No Video Loaded Yet'}</h3>
                <p className="text-sm text-slate-300">
                  {selectedFolder
                    ? 'Add an indexed YouTube video to start asking questions across this folder.'
                    : 'Please enter a YouTube URL or Video ID to analyze its transcript.'}
                </p>
                {selectedFolder ? (
                  <button onClick={() => addVideoToFolder(selectedFolder)} disabled={isLoadingVideo} className="px-5 py-2.5 rounded-xl bg-sky-400 text-slate-950 font-bold text-sm hover:bg-sky-300 transition-all inline-flex items-center gap-2 disabled:opacity-50">
                    {isLoadingVideo ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />} Add video to folder
                  </button>
                ) : (
                  <form onSubmit={handleLoadVideo} className="flex gap-2 pt-2">
                    <input
                      type="text"
                      value={videoUrl}
                      onChange={(e) => setVideoUrl(e.target.value)}
                      placeholder="Enter YouTube URL or Video ID..."
                      className="flex-1 bg-slate-900 border border-slate-700 px-4 py-2.5 rounded-xl text-sm text-white placeholder:text-slate-400 focus:outline-none focus:border-sky-400 font-medium"
                    />
                    <button
                      type="submit"
                      disabled={isLoadingVideo}
                      className="px-5 py-2.5 rounded-xl bg-sky-400 text-slate-950 font-bold text-sm hover:bg-sky-300 transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                    >
                      {isLoadingVideo ? <Loader2 className="w-4 h-4 animate-spin text-slate-950" /> : 'Load Video'}
                    </button>
                  </form>
                )}
                {videoError && (
                  <p className="text-xs text-red-300 font-semibold pt-2 flex items-center justify-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 text-red-400" /> {videoError}
                  </p>
                )}
              </div>
            ) : (
              <>
                {/* Top Bar with loaded video */}
                <div className="glass-panel p-4 rounded-2xl border border-slate-700/60 mb-6 flex flex-wrap items-center justify-between gap-4 shadow-lg">
                  <div className="flex items-center gap-3">
                    <div className="px-3 py-1 rounded-lg bg-sky-500/20 border border-sky-400/40 text-sky-300 text-xs font-mono font-bold">
                      ACTIVE INDEX
                    </div>
                    <div>
                      <span className="text-base font-bold text-white block">{videoTitle || `Video (${loadedVideoId})`}</span>
                      <span className="text-xs font-mono text-slate-300 font-medium">Video ID: `{loadedVideoId}`</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {selectedFolder && (
                      <select
                        value={chatScope === 'folder' ? 'folder' : loadedVideoId || ''}
                        onChange={(event) => {
                          const value = event.target.value;
                          setChatMessages([]);
                          if (value === 'folder') {
                            setChatScope('folder');
                            setLoadedVideoId(selectedFolder.videos[0]?.id || null);
                            setVideoTitle(selectedFolder.videos[0]?.title || null);
                          } else {
                            const video = selectedFolder.videos.find((item) => item.id === value);
                            setChatScope('video');
                            setLoadedVideoId(value);
                            setVideoTitle(video?.title || null);
                          }
                        }}
                        className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white"
                      >
                        <option value="folder">Entire Folder ({selectedFolder.videos.length})</option>
                        {selectedFolder.videos.map((video) => <option key={video.id} value={video.id}>{video.title}</option>)}
                      </select>
                    )}
                    <button
                      onClick={() => {
                        resetStateForNewVideo();
                        setLoadedVideoId(null);
                        setVideoTitle(null);
                      }}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-all border border-slate-700 cursor-pointer"
                    >
                      Change Video
                    </button>
                    <button 
                      onClick={() => setActiveTab('qa')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'qa' ? 'bg-sky-400 text-slate-950 shadow-md' : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700'}`}
                    >
                      <MessageSquare className="w-3.5 h-3.5" /> Q&A Chat
                    </button>
                    <button 
                      onClick={() => {
                        setActiveTab('summary');
                        if (!summaryText && !isSummarizing) handleFetchSummary();
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'summary' ? 'bg-sky-400 text-slate-950 shadow-md' : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700'}`}
                    >
                      <FileText className="w-3.5 h-3.5" /> Summary
                    </button>
                    <button 
                      onClick={() => {
                        setActiveTab('takeaways');
                        if (takeawaysList.length === 0 && !isGeneratingTakeaways) handleFetchTakeaways();
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'takeaways' ? 'bg-sky-400 text-slate-950 shadow-md' : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700'}`}
                    >
                      <Lightbulb className="w-3.5 h-3.5" /> Takeaways
                    </button>
                    <button 
                      onClick={() => {
                        setActiveTab('mindmap');
                        if (!mindmapCode && !isGeneratingMindmap) handleFetchMindmap();
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'mindmap' ? 'bg-sky-400 text-slate-950 shadow-md' : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700'}`}
                    >
                      <Network className="w-3.5 h-3.5" /> Mind Map
                    </button>
                    <button 
                      onClick={() => {
                        setActiveTab('quiz');
                        if (quizList.length === 0 && !isGeneratingQuiz) handleFetchQuiz();
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'quiz' ? 'bg-sky-400 text-slate-950 shadow-md' : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700'}`}
                    >
                      <HelpCircle className="w-3.5 h-3.5" /> Quiz
                    </button>
                  </div>
                </div>

                {/* Video Player & Dynamic Tabs Layout */}
                <div className="grid lg:grid-cols-12 gap-6">
                  {/* Left Column: Embedded YouTube Video with Instant Seek */}
                  <div className="lg:col-span-5 space-y-4">
                    <div className="glass-panel p-2 rounded-2xl border border-slate-700/60 overflow-hidden aspect-video shadow-xl">
                      <iframe
                        key={`${loadedVideoId}-${playerSeekTime}`}
                        className="w-full h-full rounded-xl"
                        src={`https://www.youtube.com/embed/${loadedVideoId}?autoplay=${playerSeekTime > 0 ? 1 : 0}&start=${playerSeekTime}`}
                        title="YouTube Video Player"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>

                    <div className="glass-panel p-4 rounded-xl border border-slate-700/60 text-xs text-slate-300 font-medium space-y-2">
                      <div className="flex justify-between items-center">
                        <span>Current Video Seek:</span>
                        <span className="text-sky-300 font-mono font-bold">
                          {playerSeekTime > 0 ? `${playerSeekTime}s (Active)` : '0s (Beginning)'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>FAISS Store:</span>
                        <span className="text-emerald-300 font-mono font-bold">faiss_indexes/{loadedVideoId}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Conversational Memory:</span>
                        <span className="text-purple-300 font-mono font-semibold">Active (Multi-Turn)</span>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Dynamic Tab Content */}
                  <div className="lg:col-span-7">
                    {/* 1. Q&A Chat Tab */}
                    {activeTab === 'qa' && (
                      <div className="glass-panel p-6 rounded-2xl border border-slate-700/60 flex flex-col h-[560px] shadow-xl">
                        <h3 className="text-base font-bold text-white mb-3 flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <MessageSquare className="w-4 h-4 text-sky-400" /> Multi-Turn Q&A Chat
                          </span>
                          <span className="text-[11px] font-mono text-slate-400 font-normal">Context-Grounded</span>
                        </h3>

                        {/* Messages Window */}
                        <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4">
                          {chatMessages.length === 0 ? (
                            <div className="text-center py-12 text-slate-400 text-sm font-medium">
                              No questions asked yet. Enter a question below to query the video transcript.
                            </div>
                          ) : (
                            chatMessages.map((msg, idx) => (
                              <div key={idx} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                                <div className={`max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed ${msg.sender === 'user' ? 'bg-sky-500 text-slate-950 font-bold rounded-tr-none shadow-md' : 'bg-[#121929] text-slate-100 border border-slate-700/70 rounded-tl-none shadow-md font-medium'}`}>
                                  {msg.text}
                                </div>

                                {/* AI Performance Metrics Badge */}
                                {msg.metrics && (
                                  <div className="mt-1.5 flex items-center gap-2 text-[10px] font-mono text-emerald-400 bg-emerald-950/40 px-2.5 py-1 rounded-md border border-emerald-500/20">
                                    <Gauge className="w-3 h-3" />
                                    <span>Retrieval: {msg.metrics.retrieval_ms}ms</span>
                                    <span>•</span>
                                    <span>Inference: {msg.metrics.generation_ms}ms</span>
                                    <span>•</span>
                                    <span>Top {msg.metrics.chunks_retrieved} Chunks</span>
                                  </div>
                                )}

                                {/* Timestamped Sources with In-App Seek Button */}
                                {msg.sources && msg.sources.length > 0 && (
                                  <div className="mt-3 w-full bg-[#0D1322] p-3.5 rounded-xl border border-slate-700/60 space-y-2.5">
                                    <span className="text-[11px] font-mono uppercase font-bold text-sky-300 tracking-wider flex items-center gap-1.5">
                                      <Clock className="w-3.5 h-3.5 text-sky-400" /> Interactive Citations
                                    </span>
                                    {msg.sources.map((src, sIdx) => (
                                      <div key={sIdx} className="text-xs bg-slate-900/90 p-3 rounded-lg border border-slate-800 flex flex-col gap-1.5">
                                        <div className="flex items-center justify-between">
                                          <button
                                            onClick={() => {
                                              setLoadedVideoId(src.video_id);
                                              setVideoTitle(src.title);
                                              setPlayerSeekTime(src.timestamp);
                                            }}
                                            className="text-sky-300 hover:text-sky-100 font-mono font-bold text-[11px] flex items-center gap-1 cursor-pointer bg-sky-500/20 hover:bg-sky-500/40 px-2 py-0.5 rounded transition-all"
                                            title="Click to jump video to this second"
                                          >
                                            <Play className="w-3 h-3 fill-sky-300" /> Jump to {src.formatted_timestamp}
                                          </button>
                                          <a
                                            href={src.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-white text-[10px] font-mono flex items-center gap-1 transition-all"
                                          >
                                            YouTube tab <ExternalLink className="w-2.5 h-2.5" />
                                          </a>
                                        </div>
                                        <p className="text-slate-200 text-xs italic leading-snug">"{src.text}"</p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))
                          )}

                          {isAsking && (
                            <div className="flex items-center gap-2 text-xs text-sky-300 font-mono font-bold py-2 bg-sky-950/40 px-3 rounded-lg border border-sky-500/30 w-fit">
                              <Loader2 className="w-4 h-4 animate-spin text-sky-400" /> Searching transcript & generating response...
                            </div>
                          )}
                        </div>

                        {/* Input Form */}
                        <form onSubmit={handleAskQuestion} className="flex gap-2">
                          <input
                            type="text"
                            value={question}
                            onChange={(e) => setQuestion(e.target.value)}
                            placeholder="Ask a question (supports follow-ups)..."
                            disabled={isAsking}
                            className="flex-1 bg-[#0F1626] border border-slate-700/80 px-4 py-2.5 rounded-xl text-sm text-white placeholder:text-slate-400 focus:outline-none focus:border-sky-400 font-medium disabled:opacity-50"
                          />
                          <button
                            type="submit"
                            disabled={isAsking || !question.trim()}
                            className="px-5 py-2.5 rounded-xl bg-sky-400 text-slate-950 font-bold text-sm hover:bg-sky-300 transition-all disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                          >
                            {isAsking ? <Loader2 className="w-4 h-4 animate-spin text-slate-950" /> : 'Ask'}
                          </button>
                        </form>
                      </div>
                    )}

                    {/* 2. Summary Tab */}
                    {activeTab === 'summary' && (
                      <div className="glass-panel p-6 rounded-2xl border border-slate-700/60 h-[560px] overflow-y-auto space-y-4 shadow-xl">
                        <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
                          <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <FileText className="w-5 h-5 text-purple-400" /> Video Summary
                          </h3>
                          <button
                            onClick={handleFetchSummary}
                            disabled={isSummarizing}
                            className="px-3.5 py-1.5 rounded-lg bg-purple-500/20 text-purple-200 border border-purple-400/30 text-xs font-semibold hover:bg-purple-500/30 transition-all disabled:opacity-50 cursor-pointer"
                          >
                            {isSummarizing ? 'Generating...' : 'Refresh Summary'}
                          </button>
                        </div>

                        {isSummarizing ? (
                          <div className="flex items-center justify-center py-20 text-purple-300 text-sm font-semibold gap-2">
                            <Loader2 className="w-5 h-5 animate-spin text-purple-400" /> Generating video summary via Gemini...
                          </div>
                        ) : summaryError ? (
                          <div className="p-4 rounded-xl bg-red-950/80 border border-red-500/50 text-red-200 text-sm font-semibold flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-red-400" /> {summaryError}
                          </div>
                        ) : (
                          <div className="space-y-4 text-sm text-slate-200 leading-relaxed font-normal whitespace-pre-line bg-[#0F1626] p-5 rounded-xl border border-slate-700/60">
                            {summaryText || "Click 'Refresh Summary' to generate a summary grounded in the transcript context."}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 3. Takeaways Tab */}
                    {activeTab === 'takeaways' && (
                      <div className="glass-panel p-6 rounded-2xl border border-slate-700/60 h-[560px] overflow-y-auto space-y-4 shadow-xl">
                        <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
                          <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <Lightbulb className="w-5 h-5 text-amber-400" /> Key Takeaways
                          </h3>
                          <button
                            onClick={handleFetchTakeaways}
                            disabled={isGeneratingTakeaways}
                            className="px-3.5 py-1.5 rounded-lg bg-amber-500/20 text-amber-200 border border-amber-400/30 text-xs font-semibold hover:bg-amber-500/30 transition-all disabled:opacity-50 cursor-pointer"
                          >
                            {isGeneratingTakeaways ? 'Generating...' : 'Refresh Takeaways'}
                          </button>
                        </div>

                        {isGeneratingTakeaways ? (
                          <div className="flex items-center justify-center py-20 text-amber-300 text-sm font-semibold gap-2">
                            <Loader2 className="w-5 h-5 animate-spin text-amber-400" /> Extracting key takeaways...
                          </div>
                        ) : takeawaysError ? (
                          <div className="p-4 rounded-xl bg-red-950/80 border border-red-500/50 text-red-200 text-sm font-semibold flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-red-400" /> {takeawaysError}
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {takeawaysList.length === 0 ? (
                              <div className="text-center py-12 text-slate-400 text-sm font-medium">
                                Click 'Refresh Takeaways' to extract key takeaways.
                              </div>
                            ) : (
                              takeawaysList.map((item, idx) => (
                                <div key={idx} className="bg-[#0F1626] p-4 rounded-xl border border-slate-700/60 text-sm text-slate-100 flex items-start gap-3 shadow-md">
                                  <span className="text-amber-400 font-bold font-mono text-base">{String(idx + 1).padStart(2, '0')}</span>
                                  <span className="leading-relaxed">{item}</span>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 4. Mindmap Tab */}
                    {activeTab === 'mindmap' && (
                      <div className="glass-panel p-6 rounded-2xl border border-slate-700/60 h-[560px] overflow-y-auto space-y-4 shadow-xl">
                        <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
                          <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <Network className="w-5 h-5 text-sky-400" /> Topic & Concept Mind Map
                          </h3>
                          <button
                            onClick={handleFetchMindmap}
                            disabled={isGeneratingMindmap}
                            className="px-3.5 py-1.5 rounded-lg bg-sky-500/20 text-sky-200 border border-sky-400/30 text-xs font-semibold hover:bg-sky-500/30 transition-all disabled:opacity-50 cursor-pointer"
                          >
                            {isGeneratingMindmap ? 'Generating...' : 'Refresh Mind Map'}
                          </button>
                        </div>

                        {isGeneratingMindmap ? (
                          <div className="flex items-center justify-center py-20 text-sky-300 text-sm font-semibold gap-2">
                            <Loader2 className="w-5 h-5 animate-spin text-sky-400" /> Structuring conceptual graph with Gemini...
                          </div>
                        ) : mindmapError ? (
                          <div className="p-4 rounded-xl bg-red-950/80 border border-red-500/50 text-red-200 text-sm font-semibold flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-red-400" /> {mindmapError}
                          </div>
                        ) : mindmapCode ? (
                          <div className="space-y-4">
                            <div className="bg-[#0B101D] p-4 rounded-xl border border-slate-700/70 overflow-x-auto flex justify-center">
                              <pre className="mermaid text-center font-mono text-xs text-sky-300">
                                {mindmapCode}
                              </pre>
                            </div>
                            <details className="text-xs text-slate-400">
                              <summary className="cursor-pointer hover:text-slate-200 font-mono">View Raw Mermaid Syntax</summary>
                              <pre className="mt-2 p-3 bg-slate-950 rounded-lg text-slate-300 overflow-x-auto font-mono text-[11px]">
                                {mindmapCode}
                              </pre>
                            </details>
                          </div>
                        ) : (
                          <div className="text-center py-16 text-slate-400 text-sm font-medium">
                            Click 'Refresh Mind Map' to generate a visual hierarchical flowchart of the video concepts.
                          </div>
                        )}
                      </div>
                    )}

                    {/* 5. Quiz Tab */}
                    {activeTab === 'quiz' && (
                      <div className="glass-panel p-6 rounded-2xl border border-slate-700/60 h-[560px] overflow-y-auto space-y-4 shadow-xl">
                        <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
                          <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <HelpCircle className="w-5 h-5 text-emerald-400" /> Video Knowledge Quiz
                          </h3>
                          <button
                            onClick={handleFetchQuiz}
                            disabled={isGeneratingQuiz}
                            className="px-3.5 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 text-xs font-semibold hover:bg-emerald-500/30 transition-all disabled:opacity-50 cursor-pointer"
                          >
                            {isGeneratingQuiz ? 'Generating...' : 'Generate New Quiz'}
                          </button>
                        </div>

                        {isGeneratingQuiz ? (
                          <div className="flex items-center justify-center py-20 text-emerald-300 text-sm font-semibold gap-2">
                            <Loader2 className="w-5 h-5 animate-spin text-emerald-400" /> Formulating quiz questions from transcript...
                          </div>
                        ) : quizError ? (
                          <div className="p-4 rounded-xl bg-red-950/80 border border-red-500/50 text-red-200 text-sm font-semibold flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-red-400" /> {quizError}
                          </div>
                        ) : quizList.length > 0 ? (
                          <div className="space-y-6">
                            {quizList.map((q, qIdx) => {
                              const answered = userAnswers[qIdx] !== undefined;
                              return (
                                <div key={qIdx} className="bg-[#0F1626] p-4 rounded-xl border border-slate-700/60 space-y-3">
                                  <p className="text-sm font-bold text-white">
                                    <span className="text-emerald-400 font-mono mr-2">Q{qIdx + 1}.</span>
                                    {q.question}
                                  </p>
                                  <div className="space-y-2">
                                    {q.options.map((opt, oIdx) => {
                                      const isSelected = userAnswers[qIdx] === oIdx;
                                      const isCorrect = q.correct_index === oIdx;
                                      let btnStyle = "bg-slate-900 border-slate-700 text-slate-200 hover:border-sky-400";
                                      if (answered) {
                                        if (isCorrect) {
                                          btnStyle = "bg-emerald-950/80 border-emerald-500 text-emerald-200 font-bold";
                                        } else if (isSelected) {
                                          btnStyle = "bg-red-950/80 border-red-500 text-red-200";
                                        } else {
                                          btnStyle = "bg-slate-900/40 border-slate-800 text-slate-500";
                                        }
                                      }

                                      return (
                                        <button
                                          key={oIdx}
                                          disabled={answered}
                                          onClick={() => setUserAnswers((prev) => ({ ...prev, [qIdx]: oIdx }))}
                                          className={`w-full p-2.5 rounded-lg border text-left text-xs font-medium transition-all flex items-center justify-between cursor-pointer ${btnStyle}`}
                                        >
                                          <span>{opt}</span>
                                          {answered && isCorrect && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                                          {answered && isSelected && !isCorrect && <X className="w-3.5 h-3.5 text-red-400" />}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  {answered && (
                                    <div className="text-xs bg-slate-950/70 p-2.5 rounded-lg border border-slate-800 text-slate-300">
                                      <span className="font-bold text-emerald-400">Explanation: </span>
                                      {q.explanation}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-center py-16 text-slate-400 text-sm font-medium">
                            Click 'Generate New Quiz' to test your comprehension of this video with AI-generated questions.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}


        {/* ================= INSIGHTS & SUMMARY PAGE ================= */}
        {currentPage === 'insights' && (
          <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
            <div className="text-center max-w-2xl mx-auto">
              <h1 className="text-3xl font-bold text-white mb-2">Video Insights & Summary</h1>
              <p className="text-sm text-slate-300 font-medium">Structured intelligence report for video `{loadedVideoId || 'None'}`</p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Executive Summary Card */}
              <div className="glass-panel p-6 rounded-2xl border border-slate-700/60 space-y-4 shadow-xl">
                <h3 className="text-lg font-bold text-sky-300 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-sky-400" /> Executive Overview
                </h3>
                <div className="text-sm text-slate-200 leading-relaxed font-normal bg-[#0F1626] p-4 rounded-xl border border-slate-700/60 min-h-[140px]">
                  {summaryText || 'Load a video in the workspace to view real-time executive summaries.'}
                </div>
              </div>

              {/* Takeaways Card */}
              <div className="glass-panel p-6 rounded-2xl border border-slate-700/60 space-y-4 shadow-xl">
                <h3 className="text-lg font-bold text-purple-300 flex items-center gap-2">
                  <Lightbulb className="w-5 h-5 text-purple-400" /> Essential Takeaways
                </h3>
                <div className="space-y-2 text-sm text-slate-200">
                  {takeawaysList.length > 0 ? (
                    takeawaysList.slice(0, 3).map((item, i) => (
                      <div key={i} className="p-3 rounded-lg bg-[#0F1626] border border-slate-700/60 font-medium">
                        • {item}
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-400 text-xs italic p-4 bg-[#0F1626] rounded-xl border border-slate-700/60">
                      No key takeaways loaded yet. Load a video in the workspace to extract insights.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="glass-panel border-t border-slate-700/60 py-6 px-6 text-center text-xs text-slate-400 font-mono font-semibold">
        Video-Mind AI Platform • Powered by FastAPI, Gemini 2.5 Flash, HuggingFace & FAISS
      </footer>
    </div>
  );
}
