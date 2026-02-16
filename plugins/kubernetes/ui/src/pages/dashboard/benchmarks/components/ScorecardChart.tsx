import * as React from 'react';
import { PieChart } from '@mui/x-charts/PieChart';
import { useDrawingArea } from '@mui/x-charts/hooks';
import { styled } from '@mui/material/styles';
import { useTheme } from '@mui/joy';

const StyledText = styled('text')(({ theme }) => ({
  fill: theme.palette.text.primary,
  textAnchor: 'middle',
  dominantBaseline: 'central',
  fontSize: 10,
  fontWeight: 'bolder'
}));

type Props = {
  label: string
  success: number
  warning: number
  failure: number
}

function PieCenterLabel({ children }: { children: React.ReactNode }) {
  const { width, height, left, top } = useDrawingArea();
  return (
    <StyledText x={left + width / 2} y={top + height / 2}>
      {children}
    </StyledText>
  );
}

export const ScorecardChart: React.FC<Props> = ({ label, success, warning, failure }) => {
  const theme = useTheme()

  return (
    <PieChart
      series={[
        {
          data: [
            { value: success, color: theme.palette.success[400] },
            { value: warning, color: theme.palette.warning[400] },
            { value: failure, color: theme.palette.danger[400] },
          ],
          innerRadius: 36,
          outerRadius: 50,
          cornerRadius: 2,
          paddingAngle: 2,
        }
      ]}
      height={140}
    >
      <PieCenterLabel>{label}</PieCenterLabel>
    </PieChart>
  );
}

export default ScorecardChart
