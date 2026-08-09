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
  const data = await response.json();
  if (!response.ok) {
    const errorMsg = data.detail || 'An unexpected error occurred. Please try again.';
    throw new Error(errorMsg);
  }
  return data;
}

/**
 * Load YouTube video transcript and build/retrieve FAISS index
 * @param url Video URL or 11-char Video ID
 */
export async function loadVideo(url: string) {
  const response = await fetch(`${API_BASE_URL}/video/load`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
  });
  return handleResponse(response);
}

/**
 * Ask a question regarding the video transcript
 * @param videoId 11-char Video ID
 * @param question Question string
 */
export async function askQuestion(videoId: string, question: string) {
  const response = await fetch(`${API_BASE_URL}/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ video_id: videoId, question }),
  });
  return handleResponse(response);
}

/**
 * Generate a transcript-grounded summary of the video
 * @param videoId 11-char Video ID
 */
export async function summarizeVideo(videoId: string) {
  const response = await fetch(`${API_BASE_URL}/summarize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ video_id: videoId }),
  });
  return handleResponse(response);
}

/**
 * Generate 5-10 key takeaways from the video context
 * @param videoId 11-char Video ID
 */
export async function getKeyTakeaways(videoId: string) {
  const response = await fetch(`${API_BASE_URL}/key-takeaways`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ video_id: videoId }),
  });
  return handleResponse(response);
}
