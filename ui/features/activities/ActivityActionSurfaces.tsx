import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dialog, Spinner } from '@omniviewdev/base-ui';
import {
  ActivitySurfaces,
  parseAppError,
  useActivityActions,
  withConnectionReady,
  type ActionDescriptor,
  type ActionRequest,
  type ActivityAction,
  type ActivityRecord,
  type ResourceNavigationIntent,
} from '@omniviewdev/runtime';
import { ResourceClient } from '@omniviewdev/runtime/api';
import useRightDrawer from '@/hooks/useRightDrawer';
import { ActionParameterFields } from './ActionParameterFields';
import {
  actionParameterValue,
  createActionParameterDraft,
  type ActionParameterDraft,
} from './actionParameters';
import styles from './ActivityActionSurfaces.module.css';

type Review = {
  pluginID: string;
  request: ActionRequest;
  descriptor: ActionDescriptor;
  record: ActivityRecord;
  draft: ActionParameterDraft;
};

type Props = {
  onNavigateResource?: (target: ResourceNavigationIntent) => Promise<void>;
};

async function discoverAction(pluginID: string, request: ActionRequest): Promise<ActionDescriptor> {
  const type = request.reference?.address.type ?? request.typeTarget?.type;
  if (!type || (request.reference === undefined) === (request.typeTarget === undefined)) {
    throw new Error('The action has no single canonical resource target.');
  }

  const actions = await withConnectionReady(pluginID, request.route.connection, async () =>
    ResourceClient.GetActions(pluginID, request.route, type),
  );
  const descriptor = actions.find((candidate) => candidate.id === request.action);
  if (!descriptor) {
    throw new Error(
      'This action is no longer advertised. Open the resource to review its available actions.',
    );
  }

  if ((request.reference !== undefined) !== (descriptor.scope === 'instance')) {
    throw new Error(
      'The advertised action target has changed. Open the resource to review its available actions.',
    );
  }

  return descriptor;
}

/** Host actions compose resource review/navigation into provider-neutral activity UI. */
export function ActivityActionSurfaces({ onNavigateResource }: Props) {
  const { startResourceAction } = useActivityActions();
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requiresReview, setRequiresReview] = useState(false);
  const reviewing = useRef(false);
  const submitting = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const close = useCallback(() => {
    if (submitting.current) {
      return;
    }

    setReview(null);
    setError('');
    setRequiresReview(false);
    reviewing.current = false;
  }, []);

  const handleAction = useCallback(
    async (action: ActivityAction, record: ActivityRecord) => {
      if (action.kind === 'navigate-resource') {
        if (!onNavigateResource) {
          throw new Error('Resource navigation is unavailable in this window.');
        }

        await onNavigateResource(action.target);
        return;
      }

      if (action.kind !== 'resource-action') {
        throw new Error('This action must be handled by the activity controller.');
      }

      if (reviewing.current) {
        throw new Error('Finish reviewing the current action first.');
      }

      reviewing.current = true;
      try {
        const { pluginID, request } = action.intent;
        const descriptor = await discoverAction(pluginID, request);
        const draft = createActionParameterDraft(descriptor.paramsSchema, request.input);
        if (!mounted.current) {
          reviewing.current = false;
          return;
        }

        setError('');
        setRequiresReview(false);
        setReview({ pluginID, request, descriptor, record, draft });
      } catch (cause) {
        reviewing.current = false;
        throw cause;
      }
    },
    [onNavigateResource],
  );

  const submit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!review || submitting.current || requiresReview) {
      return;
    }

    setError('');
    let input: ActionRequest['input'];
    try {
      input = actionParameterValue(review.descriptor.paramsSchema, review.draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Review the action parameters.');
      return;
    }

    submitting.current = true;
    setBusy(true);
    try {
      await withConnectionReady(review.pluginID, review.request.route.connection, async () =>
        startResourceAction({
          pluginID: review.pluginID,
          request: { ...review.request, input, expectedDescriptor: review.descriptor },
          presentation: {
            title: review.descriptor.label,
            actions: review.record.presentation.actions?.filter(
              (action) => action.kind === 'navigate-resource',
            ),
          },
          parentId: review.record.id,
        }),
      );
      submitting.current = false;
      if (mounted.current) {
        close();
      }
    } catch (cause) {
      if (mounted.current) {
        const failure = parseAppError(cause);
        setError(failure.detail || failure.title || 'The action could not be started.');
        if (failure.code === 'RESET_REQUIRED' || failure.recovery === 'refreshContract') {
          setRequiresReview(true);
          setReview((current) =>
            current ? { ...current, request: { ...current.request, input } } : current,
          );
        }
      }
    } finally {
      submitting.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  };

  const refreshReview = async () => {
    if (!review || submitting.current) {
      return;
    }

    submitting.current = true;
    setBusy(true);
    try {
      const descriptor = await discoverAction(review.pluginID, review.request);
      const draft = createActionParameterDraft(descriptor.paramsSchema, review.request.input);
      if (mounted.current) {
        setReview({ ...review, descriptor, draft });
        setRequiresReview(false);
        setError('');
      }
    } catch (cause) {
      if (mounted.current) {
        const failure = parseAppError(cause);
        setError(failure.detail || failure.title);
      }
    } finally {
      submitting.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  };

  const canHandleAction = useCallback(
    (action: ActivityAction) =>
      action.kind === 'resource-action' ||
      (action.kind === 'navigate-resource' && onNavigateResource !== undefined),
    [onNavigateResource],
  );

  return (
    <>
      <ActivitySurfaces onAction={handleAction} canHandleAction={canHandleAction} />
      {review && (
        <Dialog open size="sm" onClose={close}>
          <Dialog.Title>{review.descriptor.label}</Dialog.Title>
          <Dialog.Body>
            <p className={styles.Context}>
              {review.pluginID} · {review.request.route.connection} ·{' '}
              {review.request.reference?.address.id ?? review.request.typeTarget?.type}
            </p>
            <form
              id="activity-action-review"
              onSubmit={(event) => {
                void submit(event);
              }}
            >
              <ActionParameterFields
                schema={review.descriptor.paramsSchema}
                draft={review.draft}
                disabled={busy || requiresReview}
                onChange={(draft) => {
                  setReview((current) => (current ? { ...current, draft } : current)); 
                }
                }
              />
            </form>
            {review.descriptor.description && (
              <details className={styles.Help}>
                <summary>Action details</summary>
                <p>{review.descriptor.description}</p>
              </details>
            )}
            {review.descriptor.dangerous && (
              <p className={styles.Warning} role="alert">
                This action is marked as potentially destructive.
              </p>
            )}
            {error && (
              <p className={styles.Error} role="alert">
                {error}
              </p>
            )}
          </Dialog.Body>
          <Dialog.Footer>
            <Button color="neutral" variant="ghost" disabled={busy} onClick={close}>
              Cancel
            </Button>
            {requiresReview && (
              <Button
                disabled={busy}
                onClick={() => {
                  void refreshReview();
                }}
              >
                Review updated action
              </Button>
            )}
            <Button
              type="submit"
              form="activity-action-review"
              color={review.descriptor.dangerous ? 'danger' : 'brand'}
              disabled={busy || requiresReview}
              startDecorator={busy ? <Spinner size="xs" /> : undefined}
            >
              {review.descriptor.label}
            </Button>
          </Dialog.Footer>
        </Dialog>
      )}
    </>
  );
}

export function WorkspaceActivitySurfaces() {
  const { showResourceSidebar } = useRightDrawer();
  return <ActivityActionSurfaces onNavigateResource={showResourceSidebar} />;
}
