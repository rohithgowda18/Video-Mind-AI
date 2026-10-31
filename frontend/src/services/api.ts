const getApiBaseUrl = (): string => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && envUrl.trim() !== '') {
    const cleanUrl = envUrl.trim().replace(/\/+$/, '');
    return cleanUrl.endsWith('/api') ? cleanUrl : `${cleanUrl}/api`;
  }
  return 'http://localhost:8000/api';
};

const API_BASE_URL = getApiBaseUrl();

/**
 * Helper to handle HTTP errors cleanly
 */
async function handleResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMsg = typeof data.detail === 'string'
      ? data.detail
      : 'An unexpected error occurred. Please try again.';
    throw new Error(errorMsg);
  }
  return data;
}

/**
 * Fetch list of video IDs that have stored indexes on disk
 */
export async function getIndexedVideos() {
  const response = await fetch(`${API_BASE_URL}/videos/indexed`);
  return handleResponse(response);
}

export async function inspectPlaylist(url: string, limit = 50) {
  const response = await fetch(`${API_BASE_URL}/playlist/inspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, limit }),
  });
  return handleResponse(response);
}

export async function getVideoStatus(videoId: string) {
  const response = await fetch(`${API_BASE_URL}/video/status/${encodeURIComponent(videoId)}`);
  return handleResponse(response);
}

export async function searchTranscript(query: string, videoIds: string[]) {
  const response = await fetch(`${API_BASE_URL}/search/transcript`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, video_ids: videoIds }),
  });
  return handleResponse(response);
}

/**
 * Load YouTube video transcript and build/retrieve FAISS index
 * @param url Video URL or 11-char Video ID
 */
export async function loadVideo(url: string, folderName?: string) {
  const response = await fetch(`${API_BASE_URL}/video/load`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, folder_name: folderName }),
  });
  return handleResponse(response);
}

/**
 * Ask a question regarding the video transcript with conversational history support
 * @param videoId 11-char Video ID
 * @param question Question string
 * @param history Optional array of previous {role, content} turns
 */
export async function askQuestion(
  videoId: string | string[],
  question: string,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  videoTitles?: Record<string, string>
) {
  const response = await fetch(`${API_BASE_URL}/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      video_id: Array.isArray(videoId) ? undefined : videoId,
      video_ids: Array.isArray(videoId) ? videoId : undefined,
      video_titles: videoTitles,
      question,
      history,
    }),
  });
  return handleResponse(response);
}

/**
 * Generate a transcript-grounded summary of the video
 * @param videoId 11-char Video ID
 */
export async function summarizeVideo(videoId: string | string[], videoTitles?: Record<string, string>) {
  const response = await fetch(`${API_BASE_URL}/summarize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      video_id: Array.isArray(videoId) ? undefined : videoId,
      video_ids: Array.isArray(videoId) ? videoId : undefined,
      video_titles: videoTitles,
    }),
  });
  return handleResponse(response);
}

/**
 * Generate 5-10 key takeaways from the video context
 * @param videoId 11-char Video ID
 */
export async function getKeyTakeaways(videoId: string | string[], videoTitles?: Record<string, string>) {
  const response = await fetch(`${API_BASE_URL}/key-takeaways`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      video_id: Array.isArray(videoId) ? undefined : videoId,
      video_ids: Array.isArray(videoId) ? videoId : undefined,
      video_titles: videoTitles,
    }),
  });
  return handleResponse(response);
}

/**
 * Generate Mermaid.js concept flowchart for the video
 * @param videoId 11-char Video ID
 */
export async function getMindmap(videoId: string | string[], videoTitles?: Record<string, string>) {
  const response = await fetch(`${API_BASE_URL}/mindmap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      video_id: Array.isArray(videoId) ? undefined : videoId,
      video_ids: Array.isArray(videoId) ? videoId : undefined,
      video_titles: videoTitles,
    }),
  });
  return handleResponse(response);
}

/**
 * Generate interactive multiple-choice quiz questions
 * @param videoId 11-char Video ID
 */
export async function getQuiz(videoId: string | string[], videoTitles?: Record<string, string>) {
  const response = await fetch(`${API_BASE_URL}/quiz`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      video_id: Array.isArray(videoId) ? undefined : videoId,
      video_ids: Array.isArray(videoId) ? videoId : undefined,
      video_titles: videoTitles,
    }),
  });
  return handleResponse(response);
}
