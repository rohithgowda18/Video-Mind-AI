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
  Loader2,
  AlertCircle,
  Network,
  HelpCircle,
  Check,
  X,
  Gauge,
  FolderPlus, Pencil, Trash2, Download, Upload, Bookmark, StickyNote, BookOpen,
  PanelLeft, Home, Library, Menu, Settings2
} from 'lucide-react';
import { 
  loadVideo, 
  askQuestion, 
  summarizeVideo, 
  getKeyTakeaways,
  getMindmap,
  getQuiz,
  getIndexedVideos,
  inspectPlaylist,
  searchTranscript
} from './services/api';

declare global {
  interface Window {
    mermaid?: any;
  }
}

export default function App() {
  type LibraryVideo = { id: string; title: string; status: 'ready' | 'indexing' | 'unavailable' };
  type LibraryFolder = { id: string; name: string; videos: LibraryVideo[]; completedVideoIds: string[] };
  type BookmarkItem = { id: string; videoId: string; videoTitle: string; timestamp: number; title: string; note: string; createdAt: string; updatedAt: string };
  type ProgressItem = { videoId: string; position: number; duration?: number; lastAccessed: string; completed: boolean };
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
  const playerIframeRef = useRef<HTMLIFrameElement>(null);
  const lastProgressWriteRef = useRef(0);

  // Loading and Error States
  const [isLoadingVideo, setIsLoadingVideo] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [folders, setFolders] = useState<LibraryFolder[]>(readFolders);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('video-mind-bookmarks') || '[]');
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === 'string' && typeof item.videoId === 'string' && Number.isFinite(item.timestamp)) : [];
    } catch { return []; }
  });
  const [progress, setProgress] = useState<Record<string, ProgressItem>>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('video-mind-progress') || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch { return {}; }
  });
  const [librarySearch, setLibrarySearch] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ type: string; title: string; text?: string; videoId?: string; timestamp?: number; folder?: string }>>([]);
  const [isSearchingLibrary, setIsSearchingLibrary] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [chatScope, setChatScope] = useState<'video' | 'folder'>('video');
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogValue, setDialogValue] = useState('');
  const [toast, setToast] = useState<{ kind: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [indexingFolderId, setIndexingFolderId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) || null;
  const activeContextIds = chatScope === 'folder' && selectedFolder
    ? selectedFolder.videos.map((video) => video.id)
    : loadedVideoId ? [loadedVideoId] : [];
  const activeContextTitles = Object.fromEntries(
    (selectedFolder?.videos || []).map((video) => [video.id, video.title])
  );
  const libraryVideos = folders.flatMap((folder) => folder.videos.map((video) => ({ ...video, folderId: folder.id, folderName: folder.name })));
  const recentVideos = [...libraryVideos].reverse().slice(0, 6);
  const recentlyWatched = Object.values(progress)
    .filter((item) => item.lastAccessed)
    .sort((a, b) => b.lastAccessed.localeCompare(a.lastAccessed))
    .map((item) => ({ item, video: libraryVideos.find((video) => video.id === item.videoId) }))
    .filter((entry): entry is { item: ProgressItem; video: typeof libraryVideos[number] } => Boolean(entry.video))
    .slice(0, 4);

  const sendPlayerCommand = (func: string, args: unknown[] = []) => {
    playerIframeRef.current?.contentWindow?.postMessage(JSON.stringify({
      event: 'command',
      func,
      args,
    }), 'https://www.youtube.com');
  };

  React.useEffect(() => {
    const handlePlayerMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://www.youtube.com' || typeof event.data !== 'string') return;
      try {
        const payload = JSON.parse(event.data);
        const info = payload.info;
        if (!loadedVideoId || !info || typeof info.currentTime !== 'number') return;
        const currentTime = Math.max(0, Math.floor(info.currentTime));
        setPlayerSeekTime(currentTime);
        const ended = info.playerState === 0;
        const now = Date.now();
        if (now - lastProgressWriteRef.current < 10000) return;
        lastProgressWriteRef.current = now;
        persistProgress({
          ...progress,
          [loadedVideoId]: {
            ...(progress[loadedVideoId] || { videoId: loadedVideoId, completed: false }),
            videoId: loadedVideoId,
            position: currentTime,
            duration: typeof info.duration === 'number' ? info.duration : progress[loadedVideoId]?.duration,
            lastAccessed: new Date().toISOString(),
            completed: ended || progress[loadedVideoId]?.completed || false,
          },
        });
      } catch {
        // Ignore unrelated YouTube postMessage traffic.
      }
    };
    window.addEventListener('message', handlePlayerMessage);
    return () => window.removeEventListener('message', handlePlayerMessage);
  }, [loadedVideoId, progress]);

  const persistFolders = (next: LibraryFolder[]) => {
    setFolders(next);
    try {
      localStorage.setItem('video-mind-folders', JSON.stringify(next));
    } catch {
      setToast({ kind: 'error', message: 'Your browser could not save the library. Check storage permissions and try again.' });
    }
  };

  const persistBookmarks = (next: BookmarkItem[]) => {
    setBookmarks(next);
    try { localStorage.setItem('video-mind-bookmarks', JSON.stringify(next)); }
    catch { showToast('error', 'Bookmarks could not be saved in this browser.'); }
  };

  const persistProgress = (next: Record<string, ProgressItem>) => {
    setProgress(next);
    try { localStorage.setItem('video-mind-progress', JSON.stringify(next)); }
    catch { showToast('error', 'Learning progress could not be saved in this browser.'); }
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

  // Recover indexes that predate this browser's localStorage library.
  React.useEffect(() => {
    if (currentPage !== 'dashboard') return;
    void getIndexedVideos()
      .then((response) => {
        const indexed = Array.isArray(response?.indexes)
          ? response.indexes as Array<{ video_id?: unknown; title?: unknown; folder_name?: unknown }>
          : (Array.isArray(response?.videos) ? response.videos.map((videoId: unknown) => ({ video_id: videoId })) : []);
        setFolders((current) => {
          const metadataById = new Map(
            indexed
              .filter((item) => typeof item.video_id === 'string')
              .map((item) => [item.video_id as string, item]),
          );
          const normalized = current.map((folder) => ({
            ...folder,
            name: folder.name.toLowerCase() === 'faiss_indexes' ? 'Recovered indexes' : folder.name,
            videos: folder.videos.map((video) => {
              const metadata = metadataById.get(video.id);
              const title = typeof metadata?.title === 'string' && metadata.title.trim()
                ? metadata.title
                : video.title;
              return { ...video, title };
            }),
          }));
          const knownIds = new Set(normalized.flatMap((folder) => folder.videos.map((video) => video.id)));
          const recovered = indexed
            .filter((item) => typeof item.video_id === 'string' && !knownIds.has(item.video_id))
            .map((item) => ({
              id: item.video_id as string,
              title: typeof item.title === 'string' && item.title.trim() ? item.title : `YouTube Video (${item.video_id})`,
              folderName: typeof item.folder_name === 'string' && item.folder_name && item.folder_name !== 'faiss_indexes'
                ? item.folder_name
                : 'Recovered indexes',
            }));
          if (recovered.length === 0) return normalized;
          const next = [...normalized];
          recovered.forEach((item) => {
            const folderName = item.folderName;
            const folder = next.find((entry) => entry.name.toLowerCase() === folderName.toLowerCase());
            const video = { id: item.id, title: item.title, status: 'ready' as const };
            if (folder) folder.videos.push(video);
            else next.push({
              id: `recovered-${folderName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
              name: folderName,
              videos: [video],
              completedVideoIds: [],
            });
          });
          try { localStorage.setItem('video-mind-folders', JSON.stringify(next)); } catch { /* Storage is optional. */ }
          return next;
        });
      })
      .catch(() => {
        showToast('info', 'Saved local indexes could not be listed. You can still load a video by URL.');
      });
  }, [currentPage]);


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

  const openVideoContext = (videoId: string, title: string, timestamp = 0, folderId?: string) => {
    const folder = folders.find((item) => item.id === folderId || item.videos.some((video) => video.id === videoId));
    setSelectedFolderId(folder?.id || null);
    setChatScope('video');
    resetStateForNewVideo();
    setLoadedVideoId(videoId);
    setVideoTitle(title);
    setPlayerSeekTime(Math.max(0, Math.floor(timestamp)));
    persistProgress({
      ...progress,
      [videoId]: { ...(progress[videoId] || { videoId, position: 0, completed: false }), videoId, position: Math.max(0, Math.floor(timestamp)), lastAccessed: new Date().toISOString() },
    });
    setCurrentPage('workspace');
  };

  const addBookmark = () => {
    if (!loadedVideoId) return;
    openInputDialog('Save bookmark', 'Add a short title for this moment. You can add a note in the next step.', '', 'e.g. Important definition', 'Next', (title) => {
      const now = new Date().toISOString();
      openInputDialog('Add a note (optional)', 'Capture why this timestamp matters to you.', '', 'Your note', 'Save bookmark', (note) => {
        const bookmark: BookmarkItem = {
          id: `${Date.now()}-${loadedVideoId}`,
          videoId: loadedVideoId,
          videoTitle: videoTitle || `YouTube Video (${loadedVideoId})`,
          timestamp: Math.max(0, Math.floor(playerSeekTime)),
          title: title.trim() || `Bookmark at ${Math.floor(playerSeekTime)}s`,
          note: note.trim(),
          createdAt: now,
          updatedAt: now,
        };

        persistBookmarks([bookmark, ...bookmarks]);
        showToast('success', 'Bookmark saved.');
      });
    });
  };

  const editBookmark = (bookmark: BookmarkItem) => {
    openInputDialog('Edit bookmark', 'Update the bookmark title. Its note and timestamp will be preserved.', bookmark.title, 'Bookmark title', 'Save changes', (title) => {
      persistBookmarks(bookmarks.map((item) => item.id === bookmark.id
        ? { ...item, title: title.trim() || item.title, updatedAt: new Date().toISOString() }
        : item));
      showToast('success', 'Bookmark updated.');
    });
  };

  const moveVideo = (folder: LibraryFolder, videoId: string, direction: -1 | 1) => {
    const index = folder.videos.findIndex((video) => video.id === videoId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= folder.videos.length) return;
    const videos = [...folder.videos];
    [videos[index], videos[target]] = [videos[target], videos[index]];
    persistFolders(folders.map((item) => item.id === folder.id ? { ...item, videos } : item));
  };

  const importPlaylistToFolder = (folder: LibraryFolder) => {
    openInputDialog('Import YouTube playlist', 'Only public playlists can be inspected. Videos are indexed one at a time and unavailable items are skipped.', '', 'https://youtube.com/playlist?list=...', 'Inspect playlist', async (url) => {
      try {
        const result = await inspectPlaylist(url.trim(), 50);
        const existingIds = new Set(folder.videos.map((video) => video.id));
        const candidates = result.videos.filter((video: { video_id: string }) => !existingIds.has(video.video_id));
        let added = 0;
        const nextVideos = [...folder.videos];
        for (const candidate of candidates) {
          try {
            const loaded = await loadVideo(candidate.video_id, folder.name);
            nextVideos.push({ id: loaded.video_id, title: loaded.title || candidate.title, status: 'ready' });
            added += 1;
          } catch {
            // Keep importing other public playlist items; failures are reported below.
          }
        }
        persistFolders(folders.map((item) => item.id === folder.id ? { ...item, videos: nextVideos } : item));
        showToast('success', `Playlist import finished: ${added} added, ${result.videos.length - added} skipped or unavailable.`);
      } catch (error: any) {
        showToast('error', error.message || 'Playlist import failed.');
      }
    });
  };

  React.useEffect(() => {
    if (currentPage !== 'dashboard' || !librarySearch.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      const query = librarySearch.trim().toLowerCase();
      const results: Array<{ type: string; title: string; text?: string; videoId?: string; timestamp?: number; folder?: string }> = [];
      folders.forEach((folder) => {
        if (folder.name.toLowerCase().includes(query)) results.push({ type: 'Folder', title: folder.name });
        folder.videos.forEach((video) => {
          if (video.title.toLowerCase().includes(query) || video.id.toLowerCase().includes(query)) {
            results.push({ type: 'Video', title: video.title, videoId: video.id, folder: folder.name });
          }
        });
      });
      bookmarks.forEach((bookmark) => {
        if (`${bookmark.title} ${bookmark.note} ${bookmark.videoTitle}`.toLowerCase().includes(query)) {
          results.push({ type: 'Bookmark', title: bookmark.title, text: bookmark.note, videoId: bookmark.videoId, timestamp: bookmark.timestamp });
        }
      });
      setIsSearchingLibrary(true);
      try {
        const ids = [...new Set(folders.flatMap((folder) => folder.videos.map((video) => video.id)))];
        if (ids.length > 0) {
          const transcript = await searchTranscript(query, ids);
          transcript.results.forEach((item: { title: string; text: string; video_id: string; timestamp: number }) => {
            results.push({ type: 'Transcript', title: item.title, text: item.text, videoId: item.video_id, timestamp: item.timestamp });
          });
        }
      } catch {
        // Metadata results remain useful when transcript indexes are unavailable.
      } finally {
        setSearchResults(results.slice(0, 50));
        setIsSearchingLibrary(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [librarySearch, currentPage, folders, bookmarks]);

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
      {/* Application shell */}
      <button aria-label="Open navigation" onClick={() => setMobileNavOpen(true)} className="fixed left-4 top-4 z-50 rounded-lg border border-slate-700 bg-[#101827] p-2 text-slate-300 shadow-lg md:hidden">
        <Menu className="h-5 w-5" />
      </button>
      <aside className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-800 bg-[#0d1421] px-3 py-5 transition-all duration-200 md:translate-x-0 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'} ${sidebarCollapsed ? 'w-[76px]' : 'w-[240px]'}`}>
        <div className={`mb-8 flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3 px-2'}`}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500 text-white"><Sparkles className="h-4 w-4" /></div>
          {!sidebarCollapsed && <div><p className="text-sm font-bold tracking-tight text-white">Video-Mind AI</p><p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Learning workspace</p></div>}
        </div>
        <nav className="space-y-1">
          {[
            { id: 'landing' as const, label: 'Overview', icon: Home },
            { id: 'dashboard' as const, label: 'Library', icon: Library },
            { id: 'workspace' as const, label: 'Workspace', icon: Play },
            { id: 'insights' as const, label: 'Insights', icon: FileText },
          ].map(({ id, label, icon: Icon }) => (
            <button key={id} title={sidebarCollapsed ? label : undefined} onClick={() => { setCurrentPage(id); setMobileNavOpen(false); }} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${currentPage === id ? 'bg-indigo-500/15 text-indigo-300' : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'} ${sidebarCollapsed ? 'justify-center' : ''}`}>
              <Icon className="h-4 w-4 shrink-0" />{!sidebarCollapsed && label}
            </button>
          ))}
        </nav>
        <div className="mt-8 border-t border-slate-800 pt-5">
          {!sidebarCollapsed && <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">Your library</p>}
          <button title={sidebarCollapsed ? 'Bookmarks' : undefined} onClick={() => { setCurrentPage('dashboard'); setLibrarySearch('bookmark'); setMobileNavOpen(false); }} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 ${sidebarCollapsed ? 'justify-center' : ''}`}><Bookmark className="h-4 w-4 shrink-0" />{!sidebarCollapsed && 'Bookmarks'}</button>
          <button title={sidebarCollapsed ? 'Notes' : undefined} onClick={() => { setCurrentPage('dashboard'); setLibrarySearch('note'); setMobileNavOpen(false); }} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 ${sidebarCollapsed ? 'justify-center' : ''}`}><StickyNote className="h-4 w-4 shrink-0" />{!sidebarCollapsed && 'Notes'}</button>
          <button title={sidebarCollapsed ? 'Settings' : undefined} onClick={() => showToast('info', 'Settings will be available when accounts are enabled.')} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 ${sidebarCollapsed ? 'justify-center' : ''}`}><Settings2 className="h-4 w-4 shrink-0" />{!sidebarCollapsed && 'Settings'}</button>
        </div>
        <button aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setSidebarCollapsed((value) => !value)} className="mt-auto hidden rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-slate-200 md:block"><PanelLeft className="h-4 w-4" /></button>
      </aside>
      {mobileNavOpen && <button aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} className="fixed inset-0 z-30 bg-black/60 md:hidden" />}
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-800 bg-[#080d16]/95 px-6 backdrop-blur md:ml-0">
        <div className="pl-10 md:pl-0">
          <p className="text-xs font-medium text-slate-500">{currentPage === 'dashboard' ? 'Library' : currentPage === 'workspace' ? 'Learning workspace' : currentPage === 'insights' ? 'Insights' : 'Welcome back'}</p>
          <h1 className="text-sm font-semibold text-slate-100">{selectedFolder?.name || videoTitle || 'Video-Mind AI'}</h1>
        </div>
        <button onClick={() => setCurrentPage('dashboard')} className="hidden items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 hover:border-indigo-400 hover:text-white sm:flex"><Search className="h-3.5 w-3.5" /> Search library</button>
      </header>

        <nav className="hidden">
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

      {/* Main Content Area */}
      <main className={`min-h-screen flex-1 transition-[margin] duration-200 md:ml-[240px] ${sidebarCollapsed ? 'md:ml-[76px]' : ''}`}>
        {/* ================= LANDING PAGE ================= */}
        {currentPage === 'landing' && (
          <div className="relative overflow-hidden">
            <div className="mx-auto max-w-5xl px-4 py-16 text-center sm:px-6">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3.5 py-1.5 text-xs font-semibold text-indigo-200">
                <Sparkles className="h-4 w-4 text-indigo-300" /> Learn from every video
              </div>

              <h1 className="mb-6 text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
                Turn YouTube videos into a <span className="text-indigo-300">personal learning space.</span>
              </h1>

              <p className="mx-auto mb-10 max-w-2xl text-base leading-relaxed text-slate-400">
                Organize lessons by subject, ask grounded questions, save important moments and return to your progress whenever you study.
              </p>

              {/* URL Input Hero Form */}
              <form onSubmit={handleLoadVideo} className="max-w-2xl mx-auto mb-16">
                <div className="glass-panel flex items-center gap-2 rounded-xl p-2">
                  <div className="pl-4 text-indigo-300">
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
                    className="flex items-center gap-2 rounded-lg bg-indigo-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:opacity-50"
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
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-300">Your learning library</p>
                <h1 className="mb-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Keep learning, one idea at a time.</h1>
                <p className="text-sm text-slate-400">Pick up where you left off or organize your next subject.</p>
              </div>
              <button 
                onClick={() => setCurrentPage('workspace')}
                className="flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400"
              >
                <Play className="h-4 w-4" /> Open workspace
              </button>
            </div>

            <div className="glass-panel mb-8 rounded-2xl p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Library</h2>
                  <p className="mt-1 text-xs text-slate-400">Folders, videos and progress are stored in this browser.</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <input ref={importInputRef} type="file" accept="application/json,.json" onChange={importLibrary} className="hidden" />
                  <button onClick={() => importInputRef.current?.click()} className="px-3 py-2 rounded-lg bg-slate-800 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-2 hover:bg-slate-700">
                    <Upload className="w-4 h-4" /> Import
                  </button>
                  <button onClick={exportLibrary} disabled={folders.length === 0} className="px-3 py-2 rounded-lg bg-slate-800 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-2 hover:bg-slate-700 disabled:opacity-40">
                    <Download className="w-4 h-4" /> Export
                  </button>
                  <button onClick={createFolder} className="flex items-center gap-2 rounded-lg bg-indigo-500 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-400">
                    <FolderPlus className="h-4 w-4" /> New folder
                  </button>
                </div>
              </div>
              <div className="relative mb-5">
                <Search className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
                <input
                  aria-label="Search library"
                  value={librarySearch}
                  onChange={(event) => setLibrarySearch(event.target.value)}
                  placeholder="Search folders, videos, bookmarks, notes and transcripts..."
                  className="w-full rounded-xl bg-slate-950 border border-slate-700 pl-10 pr-10 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
                />
                {librarySearch && <button aria-label="Clear library search" onClick={() => setLibrarySearch('')} className="absolute right-3 top-3 text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>}
              </div>
              {librarySearch && (
                <div className="mb-5 rounded-xl border border-slate-700 bg-slate-950/70 divide-y divide-slate-800">
                  {isSearchingLibrary ? <p className="p-4 text-sm text-slate-400">Searching library and indexed transcripts...</p> : searchResults.length === 0 ? <p className="p-4 text-sm text-slate-400">No matching folders, videos, bookmarks or transcript chunks.</p> : searchResults.map((result, index) => (
                    <button key={`${result.type}-${result.videoId || result.title}-${index}`} onClick={() => result.videoId && openVideoContext(result.videoId, result.title, result.timestamp || 0)} className="w-full text-left p-3 hover:bg-slate-800/70 flex items-start gap-3">
                      <span className="text-[10px] uppercase tracking-wide text-sky-300 border border-sky-400/30 rounded px-1.5 py-0.5">{result.type}</span>
                      <span className="min-w-0"><span className="block text-sm font-semibold text-white truncate">{result.title}</span><span className="block text-xs text-slate-400 truncate">{result.text || result.folder || 'Open result'}</span></span>
                    </button>
                  ))}
                </div>
              )}
              {Object.values(progress).filter((item) => !item.completed).length > 0 && (
                <div className="mb-5 rounded-xl border border-indigo-400/20 bg-indigo-500/[0.07] p-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-indigo-200"><BookOpen className="h-4 w-4" /> Continue learning</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {Object.values(progress).filter((item) => !item.completed).slice(0, 5).map((item) => {
                      const video = folders.flatMap((folder) => folder.videos).find((entry) => entry.id === item.videoId);
                      return video ? <button key={item.videoId} onClick={() => openVideoContext(video.id, video.title, item.position)} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-left hover:border-indigo-400"><span className="block max-w-[220px] truncate text-xs font-semibold text-white">{video.title}</span><span className="text-[11px] text-slate-400">Resume at {Math.floor(item.position)}s</span></button> : null;
                    })}
                  </div>
                </div>
              )}
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
                          <button aria-label={`Import playlist to ${folder.name}`} onClick={() => importPlaylistToFolder(folder)} className="p-2 text-purple-300 hover:bg-purple-500/10 rounded"><Upload className="w-4 h-4" /></button>
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
                          <span className="ml-2 flex gap-1">
                            <button aria-label={`Move ${video.title} up`} onClick={() => moveVideo(folder, video.id, -1)} className="text-slate-400 hover:text-white">↑</button>
                            <button aria-label={`Move ${video.title} down`} onClick={() => moveVideo(folder, video.id, 1)} className="text-slate-400 hover:text-white">↓</button>
                          </span>
                          <button onClick={() => removeVideoFromFolder(folder, video)} className="text-red-300 ml-2 hover:text-red-200">Remove</button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
              <section className="glass-panel rounded-2xl p-5 sm:p-6">
                <div className="mb-4 flex items-center justify-between">
                  <div><h2 className="text-lg font-semibold text-white">Recently added</h2><p className="mt-1 text-xs text-slate-400">Jump back into a video from your library.</p></div>
                  <span className="text-xs text-slate-500">{libraryVideos.length} video{libraryVideos.length === 1 ? '' : 's'}</span>
                </div>
                {recentVideos.length === 0 ? <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">Your recent videos will appear here.</p> : <div className="divide-y divide-slate-800">{recentVideos.map((video) => {
                  const item = progress[video.id];
                  const percent = item?.duration ? Math.min(100, Math.round((item.position / item.duration) * 100)) : 0;
                  return <button key={`${video.folderId}-${video.id}`} onClick={() => openVideoContext(video.id, video.title, item?.position || 0, video.folderId)} className="flex w-full items-center gap-3 py-3 text-left hover:bg-slate-800/30">
                    <img src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`} alt="" className="h-14 w-24 rounded-md object-cover" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-100">{video.title}</span><span className="mt-1 block text-xs text-slate-500">{video.folderName} · {video.status === 'ready' ? 'Ready to learn' : video.status}</span>{percent > 0 && <span className="mt-2 block h-1 w-full max-w-48 rounded-full bg-slate-800"><span className="block h-1 rounded-full bg-indigo-400" style={{ width: `${percent}%` }} /></span>}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-slate-600" />
                  </button>;
                })}</div>}
              </section>
              <section className="glass-panel rounded-2xl p-5 sm:p-6">
                <div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-semibold text-white">Recently watched</h2><p className="mt-1 text-xs text-slate-400">Your latest study sessions.</p></div><Clock className="h-4 w-4 text-slate-500" /></div>
                {recentlyWatched.length === 0 ? <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">Watch a video to build your history.</p> : <div className="space-y-2">{recentlyWatched.map(({ item, video }) => <button key={video.id} onClick={() => openVideoContext(video.id, video.title, item.position, video.folderId)} className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-slate-800/60"><img src={`https://i.ytimg.com/vi/${video.id}/default.jpg`} alt="" className="h-10 w-16 rounded object-cover" /><span className="min-w-0 flex-1"><span className="block truncate text-sm text-slate-200">{video.title}</span><span className="text-xs text-slate-500">{Math.floor(item.position)}s watched</span></span><ArrowRight className="h-4 w-4 text-slate-600" /></button>)}</div>}
              </section>
            </div>
          </div>
        )}

        {/* ================= WORKSPACE PAGE ================= */}
        {currentPage === 'workspace' && (
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
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
                <div className="glass-panel mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300">
                      <Play className="h-4 w-4" />
                    </div>
                    <div>
                      <span className="block text-base font-semibold text-white">{videoTitle || `Video (${loadedVideoId})`}</span>
                      <span className="text-xs text-slate-500">{chatScope === 'folder' && selectedFolder ? `Learning across ${selectedFolder.name}` : 'Single video session'}</span>
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
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${activeTab === 'qa' ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'}`}
                    >
                      <MessageSquare className="w-3.5 h-3.5" /> Q&A Chat
                    </button>
                    <button 
                      onClick={() => {
                        setActiveTab('summary');
                        if (!summaryText && !isSummarizing) handleFetchSummary();
                      }}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${activeTab === 'summary' ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'}`}
                    >
                      <FileText className="w-3.5 h-3.5" /> Summary
                    </button>
                    <button 
                      onClick={() => {
                        setActiveTab('takeaways');
                        if (takeawaysList.length === 0 && !isGeneratingTakeaways) handleFetchTakeaways();
                      }}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${activeTab === 'takeaways' ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'}`}
                    >
                      <Lightbulb className="w-3.5 h-3.5" /> Takeaways
                    </button>
                    <button 
                      onClick={() => {
                        setActiveTab('mindmap');
                        if (!mindmapCode && !isGeneratingMindmap) handleFetchMindmap();
                      }}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${activeTab === 'mindmap' ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'}`}
                    >
                      <Network className="w-3.5 h-3.5" /> Mind Map
                    </button>
                    <button 
                      onClick={() => {
                        setActiveTab('quiz');
                        if (quizList.length === 0 && !isGeneratingQuiz) handleFetchQuiz();
                      }}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${activeTab === 'quiz' ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'}`}
                    >
                      <HelpCircle className="w-3.5 h-3.5" /> Quiz
                    </button>
                  </div>
                </div>

                {/* Video Player & Dynamic Tabs Layout */}
                <div className="grid gap-6 lg:grid-cols-12">
                  {/* Left Column: Embedded YouTube Video with Instant Seek */}
                  <div className="space-y-4 lg:col-span-7">
                    <div className="glass-panel p-2 rounded-2xl border border-slate-700/60 overflow-hidden aspect-video shadow-xl">
                      <iframe
                        ref={playerIframeRef}
                        key={loadedVideoId}
                        className="w-full h-full rounded-xl"
                        src={`https://www.youtube.com/embed/${loadedVideoId}?enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}&autoplay=${playerSeekTime > 0 ? 1 : 0}&start=${playerSeekTime}`}
                        title="YouTube Video Player"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>

                    <div className="glass-panel p-4 rounded-xl border border-slate-700/60 text-xs text-slate-300 font-medium space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Current position</span>
                        <span className="font-mono font-semibold text-indigo-300">{Math.floor(playerSeekTime)}s</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
                        <label htmlFor="manual-timestamp" className="text-slate-500">Jump to second</label>
                        <input id="manual-timestamp" type="number" min="0" value={playerSeekTime} onChange={(event) => {
                          const timestamp = Math.max(0, Number(event.target.value) || 0);
                          setPlayerSeekTime(timestamp);
                          sendPlayerCommand('seekTo', [timestamp, true]);
                        }} className="w-20 rounded bg-slate-950 border border-slate-700 px-2 py-1 text-white" />
                        <button onClick={addBookmark} className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 text-amber-200 border border-amber-400/30 font-semibold flex items-center gap-1"><Bookmark className="w-3.5 h-3.5" /> Save bookmark</button>
                        {loadedVideoId && <button onClick={() => persistProgress({ ...progress, [loadedVideoId]: { ...(progress[loadedVideoId] || { videoId: loadedVideoId, position: playerSeekTime }), videoId: loadedVideoId, position: playerSeekTime, lastAccessed: new Date().toISOString(), completed: !progress[loadedVideoId]?.completed } })} className="px-2.5 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 font-semibold">
                          {progress[loadedVideoId]?.completed ? 'Mark in progress' : 'Mark complete'}
                        </button>}
                      </div>
                      <div className="pt-2 border-t border-slate-700/60">
                        <div className="flex items-center gap-2 text-slate-300 mb-2"><StickyNote className="w-3.5 h-3.5 text-amber-300" /> Saved bookmarks</div>
                        {bookmarks.filter((bookmark) => bookmark.videoId === loadedVideoId).length === 0 ? <p className="text-slate-500">No bookmarks for this video yet.</p> : bookmarks.filter((bookmark) => bookmark.videoId === loadedVideoId).slice(0, 5).map((bookmark) => (
                          <div key={bookmark.id} className="flex items-center justify-between gap-2 py-1">
                            <button onClick={() => {
                              setPlayerSeekTime(bookmark.timestamp);
                              sendPlayerCommand('seekTo', [bookmark.timestamp, true]);
                            }} className="truncate text-left text-sky-300 hover:text-sky-200">{bookmark.title} · {Math.floor(bookmark.timestamp)}s</button>
                            <span className="flex items-center gap-1">
                              <button aria-label={`Edit bookmark ${bookmark.title}`} onClick={() => editBookmark(bookmark)} className="text-slate-300 hover:text-white"><Pencil className="w-3.5 h-3.5" /></button>
                              <button aria-label={`Delete bookmark ${bookmark.title}`} onClick={() => persistBookmarks(bookmarks.filter((item) => item.id !== bookmark.id))} className="text-red-300 hover:text-red-200"><Trash2 className="w-3.5 h-3.5" /></button>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Dynamic Tab Content */}
                  <div className="lg:col-span-5">
                    {/* 1. Q&A Chat Tab */}
                    {activeTab === 'qa' && (
                      <div className="glass-panel flex h-[560px] flex-col rounded-2xl p-5">
                        <h3 className="text-base font-bold text-white mb-3 flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <MessageSquare className="w-4 h-4 text-indigo-300" /> AI assistant
                          </span>
                          <span className="text-[11px] font-medium text-slate-500">{chatScope === 'folder' ? 'Folder context' : 'Video context'}</span>
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
