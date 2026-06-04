#!/usr/bin/env python3
"""
scripts/video_server.py

Tiny local video server — run this on your laptop to serve videos
directly to the MatTrack web app without file picking.

Usage:
    python scripts/video_server.py

Then open mattrack-five.vercel.app — it will automatically detect
the local server and show your videos as a clickable list.

Requirements:
    pip install flask flask-cors
"""

import os
import json
from pathlib import Path

# ── CONFIG ────────────────────────────────────────────────────
VIDEO_FOLDER = r"C:\Users\fmdim\OneDrive\Pictures\PhoneImport20260603"
PORT = 7432
VIDEO_EXTENSIONS = {'.mov', '.mp4', '.MOV', '.MP4', '.m4v', '.M4V', '.avi', '.AVI'}
# ─────────────────────────────────────────────────────────────

def create_app():
    from flask import Flask, Response, request, jsonify, send_file
    from flask_cors import CORS
    import mimetypes

    app = Flask(__name__)
    CORS(app, origins=['https://mattrack-five.vercel.app', 'http://localhost:3000'])

    @app.route('/ping')
    def ping():
        return jsonify({ 'status': 'ok', 'folder': VIDEO_FOLDER })

    @app.route('/videos')
    def list_videos():
        folder = Path(VIDEO_FOLDER)
        if not folder.exists():
            return jsonify({ 'error': f'Folder not found: {VIDEO_FOLDER}' }), 404

        videos = []
        for f in sorted(folder.iterdir()):
            if f.suffix in VIDEO_EXTENSIONS:
                size_mb = round(f.stat().st_size / 1024 / 1024, 1)
                videos.append({
                    'filename': f.name,
                    'path': str(f),
                    'size_mb': size_mb,
                    'url': f'http://localhost:{PORT}/video/{f.name}',
                })
        return jsonify({ 'videos': videos, 'folder': VIDEO_FOLDER, 'count': len(videos) })

    @app.route('/video/<filename>')
    def serve_video(filename):
        folder = Path(VIDEO_FOLDER)
        # Case-insensitive search
        match = None
        for f in folder.iterdir():
            if f.name.lower() == filename.lower():
                match = f
                break

        if not match or not match.exists():
            return jsonify({'error': 'File not found'}), 404

        # Support range requests for video seeking
        range_header = request.headers.get('Range')
        file_size = match.stat().st_size
        mime = mimetypes.guess_type(str(match))[0] or 'video/quicktime'

        if range_header:
            # Parse range
            byte_start = 0
            byte_end = file_size - 1
            range_spec = range_header.replace('bytes=', '')
            parts = range_spec.split('-')
            if parts[0]: byte_start = int(parts[0])
            if parts[1]: byte_end = int(parts[1])

            length = byte_end - byte_start + 1
            with open(match, 'rb') as f:
                f.seek(byte_start)
                data = f.read(length)

            response = Response(
                data, 206,
                headers={
                    'Content-Range': f'bytes {byte_start}-{byte_end}/{file_size}',
                    'Accept-Ranges': 'bytes',
                    'Content-Length': str(length),
                    'Content-Type': mime,
                }
            )
            return response
        else:
            return send_file(str(match), mimetype=mime)

    return app


if __name__ == '__main__':
    try:
        from flask import Flask
        from flask_cors import CORS
    except ImportError:
        print("Installing dependencies...")
        os.system('pip install flask flask-cors')

    print(f"\n{'='*50}")
    print(f"  MatTrack Video Server")
    print(f"{'='*50}")
    print(f"  Folder : {VIDEO_FOLDER}")
    print(f"  Port   : {PORT}")
    print(f"\n  Open mattrack-five.vercel.app")
    print(f"  Videos will appear automatically")
    print(f"\n  Press Ctrl+C to stop")
    print(f"{'='*50}\n")

    # Check folder exists
    if not Path(VIDEO_FOLDER).exists():
        print(f"WARNING: Folder not found: {VIDEO_FOLDER}")
        print("Edit VIDEO_FOLDER in this script to match your video location\n")

    app = create_app()
    app.run(host='0.0.0.0', port=PORT, debug=False, threaded=True)
