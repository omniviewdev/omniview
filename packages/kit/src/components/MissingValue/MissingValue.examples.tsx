import { MissingValue } from '@omniviewdev/kit';

/** A value that does not apply: the muted dash, named "Not applicable" for assistive technology. */
export const NotApplicable = () => <MissingValue />;

/** The name says what is missing; the dash is all that is drawn, never the words. */
export const Named = () => <MissingValue name="No value" />;

/** Unknown evidence: still the dash, with its reason in the accessible name, so it is reachable without a hover. */
export const WithReason = () => <MissingValue name="Not available" reason="The source has not reported it yet" />;
