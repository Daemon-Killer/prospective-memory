import os
import sys
import json
import shutil
from pathlib import Path
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

REPO_ROOT = Path(__file__).resolve().parent.parent
CREDS_PATH = Path(r"C:\Users\bda99\.google_workspace_mcp\credentials\aadarsh.22.2003@gmail.com.json")

BUILT_MOBILE_APK = REPO_ROOT / "reminder app" / "android" / "app" / "build" / "outputs" / "apk" / "release" / "app-release.apk"
DEST_MOBILE_APK = REPO_ROOT / "Remy-Reminders.apk"

BUILT_WEAR_APK = REPO_ROOT / "reminder app" / "wear" / "build" / "outputs" / "apk" / "debug" / "remy-wear-debug.apk"
DEST_WEAR_APK = REPO_ROOT / "Remy-Wear-debug.apk"

BUILT_ECHORECALL_APK = Path(r"C:\Users\bda99\Desktop\echorecall\android\app\build\outputs\apk\release\app-release.apk")
DEST_ECHORECALL_APK = REPO_ROOT / "EchoRecall.apk"

FOLDER_ID = "17X8zFV2b7eZiQ3xbbAGY36Nc06e1st0A"
MOBILE_FILE_ID = "17XvYljBwXW31q7T_c2T0Jmr7zrNs4YTt"
WEAR_FILE_ID = "1YqxWeHzxaFa2lkDR8Fgz2isPqD_lj4vv"

def get_drive_service():
    if not CREDS_PATH.exists():
        raise FileNotFoundError(f"OAuth credentials not found at: {CREDS_PATH}")

    with open(CREDS_PATH, "r", encoding="utf-8") as f:
        token_data = json.load(f)

    creds = Credentials(
        token=token_data.get("token"),
        refresh_token=token_data.get("refresh_token"),
        token_uri=token_data.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=token_data.get("client_id"),
        client_secret=token_data.get("client_secret"),
        scopes=token_data.get("scopes")
    )

    if creds.expired and creds.refresh_token:
        print("[Drive] Refreshing expired OAuth token...", flush=True)
        creds.refresh(Request())
        token_data["token"] = creds.token
        with open(CREDS_PATH, "w", encoding="utf-8") as f:
            json.dump(token_data, f, indent=2)
        print("[Drive] Token refreshed successfully.", flush=True)

    return build("drive", "v3", credentials=creds)

def upload_apk(service, file_path: Path, file_name: str, file_id: str = None):
    if not file_path.exists():
        raise FileNotFoundError(f"APK file does not exist: {file_path}")

    file_size = file_path.stat().st_size
    print(f"\n[Drive] Uploading {file_name} ({file_size / (1024*1024):.2f} MB)...", flush=True)

    media = MediaFileUpload(
        str(file_path),
        mimetype="application/vnd.android.package-archive",
        chunksize=5 * 1024 * 1024,
        resumable=True
    )

    # Resolve fileId if not provided or verify exists
    if not file_id:
        query = f"'{FOLDER_ID}' in parents and name = '{file_name}' and trashed = false"
        results = service.files().list(q=query, fields="files(id, name, webViewLink)").execute()
        files = results.get("files", [])
        if files:
            file_id = files[0]["id"]

    if file_id:
        request = service.files().update(
            fileId=file_id,
            media_body=media,
            fields="id, name, webViewLink, size"
        )
    else:
        request = service.files().create(
            body={"name": file_name, "parents": [FOLDER_ID]},
            media_body=media,
            fields="id, name, webViewLink, size"
        )

    response = None
    retries = 0
    while response is None:
        try:
            status, response = request.next_chunk()
            if status:
                print(f"[Drive] Upload progress: {int(status.progress() * 100)}%...", flush=True)
            retries = 0
        except Exception as e:
            retries += 1
            if retries > 8:
                print(f"[Drive] Fatal upload error after {retries} retries: {e}", flush=True)
                raise
            import time
            wait_sec = min(2 ** retries, 20)
            print(f"[Drive] Network glitch ({e}), retrying in {wait_sec}s (retry {retries}/8)...", flush=True)
            time.sleep(wait_sec)

    print(f"\n[Drive] Upload Successful!", flush=True)
    print(f"[Drive] File Name: {response.get('name')}", flush=True)
    print(f"[Drive] File ID:   {response.get('id')}", flush=True)
    print(f"[Drive] Web Link:  {response.get('webViewLink')}", flush=True)

    try:
        service.permissions().create(
            fileId=response.get("id"),
            body={"role": "reader", "type": "anyone"}
        ).execute()
        print("[Drive] Permissions: Public download access confirmed.", flush=True)
    except Exception as e:
        print(f"[Drive] Permission notice: {e}", flush=True)

    return response

def main():
    service = get_drive_service()

    # Upload EchoRecall APK if built
    if BUILT_ECHORECALL_APK.exists():
        print(f"[Pipeline] Copying built EchoRecall APK: {DEST_ECHORECALL_APK.name}...", flush=True)
        shutil.copy2(BUILT_ECHORECALL_APK, DEST_ECHORECALL_APK)
        upload_apk(service, DEST_ECHORECALL_APK, "EchoRecall.apk")
    else:
        print(f"[Pipeline] EchoRecall APK not found at {BUILT_ECHORECALL_APK}.", flush=True)

    # Upload Mobile APK if built
    if BUILT_MOBILE_APK.exists():
        print(f"[Pipeline] Copying built Mobile APK: {DEST_MOBILE_APK.name}...", flush=True)
        shutil.copy2(BUILT_MOBILE_APK, DEST_MOBILE_APK)
        upload_apk(service, DEST_MOBILE_APK, "Remy-Reminders.apk", MOBILE_FILE_ID)
    else:
        print(f"[Pipeline] Mobile APK not found at {BUILT_MOBILE_APK} (skipping mobile upload).", flush=True)

    # Upload Wear OS APK if built
    if BUILT_WEAR_APK.exists():
        print(f"[Pipeline] Copying built Wear OS APK: {DEST_WEAR_APK.name}...", flush=True)
        shutil.copy2(BUILT_WEAR_APK, DEST_WEAR_APK)
        upload_apk(service, DEST_WEAR_APK, "Remy-WearOS.apk", WEAR_FILE_ID)
    else:
        print(f"[Pipeline] Wear OS APK not found at {BUILT_WEAR_APK} (skipping wear upload).", flush=True)

if __name__ == "__main__":
    main()
