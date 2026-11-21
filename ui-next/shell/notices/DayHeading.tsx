import { useAge } from '@omniviewdev/kit';
import { dayAge } from './centreList';
import styles from './Centre.module.css';

// The heading of a day in the notification centre's list (ch16 S80; the mock's `dayLabel`, shell-feedback.js): Today, Yesterday, then the date. Its words are the AGE of its day, kept current by the page's one age clock (the
// one that keeps the rows' times), so they change at the local midnight by themselves while the centre is open, and a heading that appears later (the first notice of a new day) says what the day is NOW and not what it was when
// the centre was opened. The mock reads the clock when it draws the list and has no timer for midnight.

export function DayHeading({ day }: { readonly day: number }) {
  const text = useAge(day, dayAge);
  return (
    <h5 className={styles.labelText} data-notices-part="centreLabel">
      {text}
    </h5>
  );
}
