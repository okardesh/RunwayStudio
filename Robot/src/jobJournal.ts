import fs from 'node:fs';
import path from 'node:path';
import type { RobotJobView } from '../../src/shared/robotJobs';
import type { HumanCheckpoint } from '../../src/shared/humanTasks';
export interface JournalEntry { fingerprint: string; view: RobotJobView; checkpoint?: HumanCheckpoint; callbackUrl?: string }
export interface JobJournal { load(): JournalEntry[]; save(entry: JournalEntry): void }
export function jobJournal(directory: string): JobJournal {
  const folder = path.join(directory, 'human-job-receipts'); fs.mkdirSync(folder, { recursive: true });
  return {
    load: () => fs.readdirSync(folder).filter(n => /^[a-zA-Z0-9_-]+\.json$/.test(n)).map(name => {
      const entry = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')) as JournalEntry;
      if (['queued','running','stopping'].includes(entry.view.status)) { entry.view.status = 'failed'; entry.view.error = 'Robot restarted after accepting work. Review external effects before starting a new job; this checkpoint will not be replayed.'; entry.view.completedAt = Date.now(); }
      return entry;
    }),
    save: entry => {
      if (!/^[a-zA-Z0-9_-]{1,120}$/.test(entry.view.jobId)) throw Error('Invalid journal job ID.');
      const file = path.join(folder, entry.view.jobId + '.json'), temporary = file + '.new';
      const fd = fs.openSync(temporary, 'w', 0o600); try { fs.writeFileSync(fd, JSON.stringify(entry)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(temporary, file);
    },
  };
}
