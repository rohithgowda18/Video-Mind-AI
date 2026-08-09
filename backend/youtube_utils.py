import re
import urllib.parse
import urllib.request
import json
from typing import List, Dict, Any, Tuple

from youtube_transcript_api import (
    YouTubeTranscriptApi,
    TranscriptsDisabled,
    NoTranscriptFound,
    InvalidVideoId,
    VideoUnavailable,
)

def extract_video_id(url_or_id: str) -> str:
    """Extract and return 11-character YouTube video ID from various URL formats or raw ID string."""
    if not url_or_id:
        return ""
    url_or_id = url_or_id.strip()

    # Raw Video ID format check
    if re.match(r"^[a-zA-Z0-9_-]{11}$", url_or_id):
        return url_or_id

    try:
        parsed = urllib.parse.urlparse(url_or_id)
        # Standard youtube.com domain
        if parsed.netloc in ("www.youtube.com", "youtube.com", "m.youtube.com"):
            if parsed.path == "/watch":
                qs = urllib.parse.parse_qs(parsed.query)
                if "v" in qs and len(qs["v"][0]) == 11:
                    return qs["v"][0]
            elif parsed.path.startswith(("/embed/", "/v/", "/shorts/")):
                parts = [p for p in parsed.path.split("/") if p.strip()]
                if len(parts) >= 2 and len(parts[1]) == 11:
                    return parts[1]

        # Short youtu.be domain
        elif parsed.netloc in ("youtu.be", "www.youtu.be"):
            vid = parsed.path.lstrip("/")
            if len(vid) == 11:
                return vid
    except Exception:
        pass

    return ""


def validate_video_id(video_id: str) -> bool:
    """Validate if video_id is a non-empty 11-character alphanumeric YouTube ID."""
    if not video_id:
        return False
    return bool(re.match(r"^[a-zA-Z0-9_-]{11}$", video_id.strip()))


def create_youtube_timestamp_url(video_id: str, seconds: float) -> str:
    """Generate direct playable YouTube URL at specified timestamp in seconds."""
    return f"https://www.youtube.com/watch?v={video_id}&t={int(seconds)}"


def format_timestamp(seconds: float) -> str:
    """Format float seconds into readable HH:MM:SS or MM:SS format."""
    seconds = int(seconds)
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def fetch_video_details(video_id: str) -> Tuple[str, str]:
    """Fetch video title and thumbnail URL using YouTube oEmbed endpoint."""
    title = f"YouTube Video ({video_id})"
    thumbnail_url = f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"
    try:
        oembed_url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
        req = urllib.request.Request(oembed_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            title = data.get("title", title)
            thumbnail_url = data.get("thumbnail_url", thumbnail_url)
    except Exception:
        pass
    return title, thumbnail_url


def fetch_transcript(video_id: str) -> List[Dict[str, Any]]:
    """Fetch transcript snippets with start timestamp and duration metadata for a given video ID."""
    if not validate_video_id(video_id):
        raise ValueError("Invalid YouTube URL or Video ID.")

    try:
        ytt_api = YouTubeTranscriptApi()
        transcript_snippets = ytt_api.fetch(video_id, languages=["en"])
        
        snippets_data = []
        for snippet in transcript_snippets:
            text = snippet.text.strip() if hasattr(snippet, "text") else ""
            if text:
                snippets_data.append({
                    "text": text,
                    "start": float(snippet.start) if hasattr(snippet, "start") else 0.0,
                    "duration": float(snippet.duration) if hasattr(snippet, "duration") else 0.0,
                })
        
        if not snippets_data:
            raise ValueError("No transcript is available for this video.")
            
        return snippets_data

    except TranscriptsDisabled:
        raise RuntimeError("No transcript is available for this video.")
    except NoTranscriptFound:
        raise RuntimeError("No English transcript is available for this video.")
    except InvalidVideoId:
        raise ValueError("Invalid YouTube URL or Video ID.")
    except VideoUnavailable:
        raise RuntimeError("This YouTube video is unavailable or restricted.")
    except Exception as e:
        if isinstance(e, (ValueError, RuntimeError)):
            raise e
        raise RuntimeError(f"Unable to process this video: {str(e)}")
