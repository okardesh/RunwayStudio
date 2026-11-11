import type { IpcMain, WebContents } from 'electron';
import { postLicenseRequest, type LicenseRequest, type LicenseTransportResult } from '../src/shared/runwayLicenseTransport';

export function registerRunwayLicenseIpc(ipcMain: IpcMain, studioContents: () => WebContents | undefined) {
  ipcMain.handle('runway:license-request', async (event, request: LicenseRequest): Promise<LicenseTransportResult> => {
    const trusted = studioContents();
    if (!trusted || trusted.isDestroyed() || event.sender !== trusted
      || event.senderFrame?.routingId !== trusted.mainFrame.routingId
      || event.senderFrame?.processId !== trusted.mainFrame.processId) {
      return { status: 0, body: '', error: { code: 'UNTRUSTED_SENDER', message: 'License requests must originate from the Studio window.' } };
    }
    return postLicenseRequest(request);
  });
}
