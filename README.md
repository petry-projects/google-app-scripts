# Google Apps Script Productivity Suite

A collection of personal productivity scripts built on Google Apps Script. These tools are designed to automate repetitive tasks across Gmail, Google Drive, and Google Docs, helping you reclaim your time and keep your digital workspace organized.

Open sourced under the MIT License to help others build their own automation workflows.

## 📂 Script Catalog

| Script Name | Description | Documentation |
| :--- | :--- | :--- |
| **Gmail to Drive By Labels** | Automatically archives emails from specific Gmail labels into a Google Doc (text) and Google Drive Folder (attachments). Features robust text cleaning (removing quoted replies/legal footers) and smart content-based attachment de-duplication. | [View Readme](./src/gmail-to-drive-by-labels/README.md) |
| **Calendar to Sheets** | Syncs Google Calendar events into a Google Sheet, keeping rows up to date on changes and deletions. | [View Readme](./src/calendar-to-sheets/README.md) |

## 🚀 Getting Started

1.  **Browse the Catalog:** Check the table above to find a script that fits your needs.
2.  **Open the Folder:** Navigate to the specific script folder (e.g., `/src/gmail-to-drive-by-labels`).
3.  **Code & Config Convention:** Each script places the runnable code in `code.gs` and configuration values in `config.gs`.
4.  **Copy the Code:** Open `code.gs` (and `config.gs`) in the folder and copy them into a new [Google Apps Script project](https://script.google.com/).
5.  **Configure:** Update `config.gs` values (spreadsheet id, sheet name, etc.) and follow the specific setup instructions in that script's `README.md`.

## 🤝 Contributing

Contributions are welcome! If you have ideas for improvements or new scripts to add to the suite:

1.  Fork the repository.
2.  Create a feature branch (`git checkout -b feature/AmazingScript`).
3.  Commit your changes.
4.  Open a Pull Request.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

*Note: These scripts are provided "as is". Always test on a small batch of data before running on important files.*
