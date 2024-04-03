import { useEffect, useMemo, useState } from 'react';

import { Typography } from '@mui/joy';
import {
  differenceInSeconds,
  differenceInMinutes,
  differenceInHours,
  differenceInDays,
} from 'date-fns';

/**
  * Formats the time difference between the given date and the current date
  * @param date The date to calculate the difference from
  */
function formatTimeDifference(date: Date) {
  const now = new Date();
  const sec = differenceInSeconds(now, date);
  const min = differenceInMinutes(now, date);
  const hours = differenceInHours(now, date);
  const days = differenceInDays(now, date);

  // Days
  if (days > 0) {
    return `${days}d`;
  }

  // Hours and minutes
  if (hours > 0) {
    const remainingMinutes = min - hours * 60;
    return `${hours}h${remainingMinutes > 0 ? `${remainingMinutes}m` : ''}`;
  }

  // Only minutes and seconds
  if (min > 0) {
    const remainingSeconds = sec - min * 60;
    return `${min}m${remainingSeconds > 0 ? `${remainingSeconds}s` : ''}`;
  }

  // Only seconds
  return `${sec}s`;
}

export const Age = ({ startTime }: { startTime: string }) => {
  // Memoize the initial age calculation
  const initialAge = useMemo(() => {
    const date = new Date(startTime);
    if (!startTime || isNaN(date.getTime())) {
      return '0s';
    }

    return formatTimeDifference(date);
  }, [startTime]);

  const [time, setTime] = useState(initialAge);

  useEffect(() => {
    const date = new Date(startTime);
    if (isNaN(date.getTime())) {
      // Early return if startTime is not a valid date
      return;
    }

    const updateAge = () => {
      setTime(formatTimeDifference(date)); 
    };

    // Set the interval to update the age every 60 seconds
    const intervalId = setInterval(updateAge, 1000); // Adjusted to 60 seconds

    // Cleanup the interval on component unmount
    return () => {
      clearInterval(intervalId); 
    };
  }, [startTime, initialAge]);

  return <Typography level='body-xs'>{time}</Typography>;
};
