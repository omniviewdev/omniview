import { Button, SearchField, WorkspaceToolbar } from '@omniviewdev/kit';
import { useState } from 'react';

// The lane written the way a consumer writes it: the controls are the view's, the lane only lays them out.
function Lane({ filtered, withEnd }: { readonly filtered: boolean; readonly withEnd: boolean }) {
  const [draft, setDraft] = useState(filtered ? 'orders' : '');
  return (
    <WorkspaceToolbar
      label="Search and filter items"
      end={withEnd ? (
        <Button variant="ghost" size="compact" icon="columns">
          Columns
        </Button>
      ) : undefined}
    >
      <SearchField label="Search items" value={draft} onValueChange={setDraft} />
      {filtered ? (
        <Button
          variant="ghost"
          size="compact"
          icon="close"
          onClick={() => {
            setDraft('');
          }}
        >
          Clear filters
        </Button>
      ) : null}
    </WorkspaceToolbar>
  );
}

/** The search field alone: it takes the whole lane. */
export const Default = () => <Lane filtered={false} withEnd={false} />;

/** The field, a Clear filters command while a filter is on, and the Columns chooser at the end of the lane. The count is not here: the footer has it. */
export const WithFiltersAndEnd = () => <Lane filtered withEnd />;
