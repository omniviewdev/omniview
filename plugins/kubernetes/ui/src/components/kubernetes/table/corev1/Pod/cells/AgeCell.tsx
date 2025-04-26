import React from 'react';

import { formatTimeDifference } from '../../../../../../utils/time';

const AgeCell: React.FC<{ value: string }> = ({ value }) => {
  // Memoize the initial age calculation
  const initialAge = React.useMemo(() => {
    const date = new Date(value);
    if (!value || isNaN(date.getTime())) {
      return '0s';
    }

    return formatTimeDifference(date);
  }, [value]);

  const [time, setTime] = React.useState(initialAge);

  React.useEffect(() => {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      // Early return if value is not a valid date
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
  }, [value, initialAge]);

  return <>{time}</>;
};

export default AgeCell
