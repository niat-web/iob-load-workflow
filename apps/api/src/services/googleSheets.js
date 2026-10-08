import { GoogleAuth } from "google-auth-library";
import { config } from "../config/env.js";
import { IntegrationError } from "../utils/errors.js";

const BASE_URL = "https://sheets.googleapis.com/v4/spreadsheets";
const range = (worksheet) => encodeURIComponent(`'${worksheet.replaceAll("'", "''")}'`);

class LiveSheets {
  constructor({ sheetId, credentials }) {
    this.sheetId = sheetId;
    this.auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  }

  get enabled() {
    return true;
  }

  async request(method, path, data) {
    try {
      const client = await this.auth.getClient();
      const response = await client.request({ url: `${BASE_URL}/${encodeURIComponent(this.sheetId)}${path}`, method, data });
      return response.data;
    } catch (error) {
      const status = error?.response?.status ?? error?.status;
      throw new IntegrationError(`Google Sheets request failed: ${error?.message ?? status}`, {
        integration: "sheets",
        status,
        retryable: !status || status === 429 || status >= 500,
        cause: error,
      });
    }
  }

  async getRows(worksheet) {
    const data = await this.request("GET", `/values/${range(worksheet)}`);
    return data?.values ?? [];
  }
}

class DisabledSheets {
  get enabled() {
    return false;
  }

  async getRows() {
    return [];
  }
}

export class InMemorySheets {
  constructor(worksheets = {}) {
    this.worksheets = structuredClone(worksheets);
  }

  get enabled() {
    return true;
  }

  async getRows(worksheet) {
    return structuredClone(this.worksheets[worksheet] ?? []);
  }
}

export function createSheetsClient() {
  const { sheetId, credentials } = config.jobLoadingSheet;
  if (!sheetId || !credentials || config.modes.learningPortal !== "live") return new DisabledSheets();
  return new LiveSheets({ sheetId, credentials });
}
