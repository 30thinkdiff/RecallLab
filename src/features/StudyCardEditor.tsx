import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../persistence/database';
import type { PracticeItem, StudySession } from '../domain/models';
import { CardForm } from './CardEditor';
import { StudyDraftController } from './study-draft';
import { editingService } from '../persistence/editing-service';
import { useAction } from '../components/actions';
import { ErrorNotice } from '../components/shared';
export function StudyCardEditor({
  session,
  card,
  controller,
  beforeOpen,
  blocked,
}: {
  session: StudySession;
  card: PracticeItem | undefined;
  controller: StudyDraftController;
  beforeOpen: () => Promise<void>;
  blocked: boolean;
}) {
  const [open, setOpen] = useState(false),
    [dismissed, setDismissed] = useState<string>();
  const action = useAction();
  const saved = useLiveQuery(
    async () =>
      (await db.editorDrafts.where('sessionId').equals(session.id).toArray()).find(
        (d) =>
          d.kind === 'card' &&
          !d.id.startsWith('recovery:') &&
          d.practiceItemId === card?.id &&
          d.baseRevisionId?.startsWith(`${session.queue[session.index]?.revisionId}@`),
      ),
    [session.id, session.index, card?.id],
  );
  return (
    <>
      <button
        type="button"
        className="text-button"
        disabled={blocked || action.busy}
        onClick={() =>
          void action.run(async () => {
            await beforeOpen();
            setOpen(true);
          })
        }
      >
        修改这道题
      </button>
      <ErrorNotice message={action.error} />
      {(open || (!!saved && saved.id !== dismissed && session.draft.wasAnswerRevealed)) && card && (
        <CardForm
          projectId={session.projectId}
          card={card}
          sessionId={session.id}
          onClose={() => {
            setDismissed(saved?.id);
            setOpen(false);
          }}
          onStudySave={async (record, input, confirm) => {
            const result = await controller.withCurrent((s, token) =>
              editingService.correctInStudy(s.id, s.index, token, record, input, confirm),
            );
            if (result.advanced) controller.acknowledgeTransition();
          }}
        />
      )}
    </>
  );
}
