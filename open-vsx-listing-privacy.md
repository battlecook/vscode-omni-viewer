# Open VSX Listing Information (Planned Share Feature)

Omni Viewer does **not** currently enable this share upload/download flow in the released extension.
This section documents the intended privacy behavior for a future share feature release.

## What will be collected when sharing (planned)
- The file selected by the user for sharing (single file upload)
- Metadata: filename, content type, file size, file type, and optional file_meta (for example audio/video region, row range, sheet index)
- Platform/source identifier (for example `vscode`)

## Why this data will be collected
- To create a temporary share link
- To allow recipients to download/view the shared file for a limited time

## Planned storage and processing
- Temporary server-side processing for share link creation
- Cloud storage for uploaded shared files
- Database storage for temporary share metadata

## Planned retention and expiration
- Default share link lifetime: **5 minutes**
- After expiration, the share will no longer be accessible (`410`)
- Expired data may be removed by backend cleanup/lifecycle policies

## Planned link access model
- Upload endpoint: authenticated request required (API key-based)
- Download endpoint: link-based access with non-guessable share ID
- Optional per-share max access count may be enforced

## Privacy Policy
https://omni-viewer-web.web.app/privacy
