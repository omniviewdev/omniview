import { SearchField } from '@omniviewdev/kit';
import { useState } from 'react';

// A field written the way a consumer writes it: the caller owns the draft. A page that searches a long list waits 500 ms after the last
// change before it filters; the field reports every change at once and leaves that delay to the page.
function Draft({ initial = '', count, invalid }: { readonly initial?: string; readonly count?: string; readonly invalid?: boolean }) {
  const [draft, setDraft] = useState(initial);
  return <SearchField label="Search items" value={draft} onValueChange={setDraft} count={count} invalid={invalid} />;
}

/** An empty field: the glyph and the hint. It is one tab stop. */
export const Default = () => <Draft />;

/** With text: the clear button appears at the end of the field, for the pointer. Escape clears it from the keyboard. */
export const WithText = () => <Draft initial="orders" />;

/** A search in content has a result to show ("3 of 12"): the count lane takes a fixed width inside the field, so the text it holds can change or go and nothing moves. */
export const WithCount = () => <Draft initial="orders" count="3 of 12" />;

/** The text cannot be searched for: the field and its lane take the error colour, and the field says so to assistive technology. */
export const Invalid = () => <Draft initial="(orders" count="Invalid pattern" invalid />;
