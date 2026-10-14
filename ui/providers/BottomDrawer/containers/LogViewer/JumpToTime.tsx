import React, { useState } from 'react';
import { Button, Calendar, IconButton, Popover, TimeColumns } from '@omniviewdev/base-ui';
import { LuCalendarClock } from 'react-icons/lu';
import HintTooltip from '@/components/base/HintTooltip';
import styles from './JumpToTime.module.css';

type Props = {
  onJumpToTime: (date: Date) => void;
};

/** Calendar plus 24h time columns; "Jump" scrolls the log to that moment. */
const JumpToTime: React.FC<Props> = ({ onJumpToTime }) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<Date>(() => new Date());

  // Picking a day keeps the selected time, and vice versa.
  const handleDateChange = (date: Date) => {
    const next = new Date(date);
    next.setHours(value.getHours(), value.getMinutes(), value.getSeconds(), 0);
    setValue(next);
  };

  const handleTimeChange = (time: Date) => {
    const next = new Date(value);
    next.setHours(time.getHours(), time.getMinutes(), time.getSeconds(), 0);
    setValue(next);
  };

  const handleJump = () => {
    onJumpToTime(value);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <HintTooltip content='Jump to time'>
        <Popover.Trigger
          render={
            <IconButton size='sm' variant='ghost' color='neutral' aria-label='Jump to time'>
              <LuCalendarClock size={14} />
            </IconButton>
          }
        />
      </HintTooltip>
      <Popover.Portal>
        <Popover.Positioner side='top' align='start' sideOffset={4}>
          <Popover.Popup className={styles.Popup}>
            <div className={styles.Body}>
              <Calendar value={value} onChange={handleDateChange} />
              <div className={styles.Time}>
                <TimeColumns value={value} onChange={handleTimeChange} hourCycle={24} showSeconds />
              </div>
            </div>
            <div className={styles.Footer}>
              <Button size='sm' variant='ghost' color='brand' onClick={handleJump}>
                Jump
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default React.memo(JumpToTime);
