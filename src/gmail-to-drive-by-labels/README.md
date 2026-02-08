# Gmail to Drive By Labels

A robust Google Apps Script designed to automate the archiving of Gmail threads. It prepends email body text to the top of a Google Doc (newest content first) and intelligently saves attachments to a specific Google Drive folder based on Gmail labels.

## Example Use-Cases
### 1. Collect and store all documents related to an ongoing topic into Google Drive which can act as a source of grounding for a Notebook system. Use Gmail Filters to automatically label incoming emails and have them feed into your Notebook RAG.

## Features

**Automated Archiving:**
* Scans for emails with a specific "Trigger Label" and processes them automatically.
* Processing is performed on a per-item basis allowing resumption after timeouts

**Clean Output:**
* Strips quoted replies (e.g., "On [Date]... wrote:").
* Removes "Confidentiality Notice" legal footers.
* Removes lines starting with `>` or `<`.

**Content-Based De-duplication:** 
* Uses MD5 hashing (digital fingerprinting) to detect if a file is an exact duplicate of one already in the folder, even if the filename is different.

**Safe Renaming:** 
* If a file has the same name but *different* content, it automatically appends a timestamp to the filename to prevent overwriting data.

**Robust Processing:** 
* Includes error handling and delays to prevent Google Docs "Unexpected Error" crashes during high-volume loops.

**Label Management:**
* Automatically removes the trigger label and applies an "Archived" label after processing.

## Setup Instructions

### 1. Create the Script Files

1. Open [Google Apps Script](https://script.google.com/).
2. Create a new project.
3. Create two files in the editor:
* `Code.gs`: Paste the main logic code.
* `Config.gs`: Paste the configuration code.



### 2. Prepare Destination Files

* **Google Doc:** Create a new Google Doc (or use an existing one) to act as the log for email text.
* **Google Drive Folder:** Create a folder where attachments will be saved.

### 3. Get Your IDs

You will need to extract IDs from your browser URL bar:

* **Doc ID:** The string between `/d/` and `/edit` in the Doc URL.
* *Example:* `https://docs.google.com/document/d/`**`1vN7xdaLW0ZDWUjgP2yJ5ETb9t3ZlDT10s9IxNOt7yXA`**`/edit`


* **Folder ID:** The string at the end of the Folder URL.
* *Example:* `https://drive.google.com/drive/folders/`**`10s9IxNOt7yXA_Example_Folder_ID`**



## Configuration (`Config.gs`)

Open `Config.gs` and update the `PROCESS_CONFIG` array.

```javascript
function getProcessConfig() {
  return [
    {
      // The label that triggers the script
      // NOTE: For nested labels, use the full path: "Parent/Child"
      triggerLabel: "Projects/toby-mcaa", 
      
      // The label applied after successful processing
      processedLabel: "Projects/toby-mcaa-archived",
      
      // The Google Doc ID found in step 3
      docId: "YOUR_GOOGLE_DOC_ID_HERE", 
      
      // The Drive Folder ID found in step 3
      folderId: "YOUR_DRIVE_FOLDER_ID_HERE",
      
      // Optional: Number of threads to process per batch during rebuild
      // Default is 250 if not specified. Increase for faster rebuilds,
      // decrease if experiencing timeouts.
      batchSize: 250
    }
  ];
}

```

## Usage

### Regular Processing

1. Select `storeEmailsAndAttachments` from the function dropdown in the Apps Script toolbar.
2. Click **Run**.
3. Grant permissions when prompted (access to Gmail, Drive, and Docs).
4. Check the **Execution Log** for progress.

### Rebuilding Documents

If you've updated the cleaning logic (e.g., `getCleanBody` function) or want to regenerate documents with new processing rules:

1. Select `rebuildAllDocs` from the function dropdown in the Apps Script toolbar.
2. Click **Run** - this will:
   * Clear all configured Google Docs
   * Move all processed/archived emails back to their trigger labels
3. Then run `storeEmailsAndAttachments` to reprocess all emails with the updated logic.

**Note:** The rebuild process moves (not copies) emails back to trigger labels, ensuring all emails are reprocessed exactly once with the latest logic while maintaining incremental processing to avoid script timeouts.

## Automation (Optional)

To run this script automatically (e.g., every hour):

1. Click on the **Triggers** icon (alarm clock) in the left sidebar.
2. Click **+ Add Trigger**.
3. **Function to run:** `storeEmailsAndAttachments`.
4. **Event source:** `Time-driven`.
5. **Type of time based trigger:** `Hour timer` (or as preferred).
6. Click **Save**.

## Cleaning Logic Details

The script uses regex patterns to clean the email body. It specifically looks for and removes:

* **Headers:** `On [Date], [Name] wrote:` (Gmail), `From: ... Sent:` (Outlook).
* **Footers:** Any line containing "Confidentiality Notice" (case-insensitive) and everything following it.
* **Quote characters:** Any line starting with `>` or `<`.

## License
MIT
