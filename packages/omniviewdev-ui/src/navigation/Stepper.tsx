import MuiStepper from '@mui/material/Stepper';
import MuiStep from '@mui/material/Step';
import MuiStepLabel from '@mui/material/StepLabel';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

export interface StepItem {
  label: string;
  description?: string;
  icon?: React.ReactNode;
  optional?: boolean;
}

export interface StepperProps {
  steps: StepItem[];
  activeStep: number;
  orientation?: 'horizontal' | 'vertical';
  variant?: 'linear' | 'nonLinear';
  sx?: SxProps<Theme>;
}

export default function Stepper({
  steps,
  activeStep,
  orientation = 'horizontal',
  variant = 'linear',
  sx,
}: StepperProps) {
  return (
    <MuiStepper
      activeStep={activeStep}
      orientation={orientation}
      nonLinear={variant === 'nonLinear'}
      sx={sx}
    >
      {steps.map((step, index) => (
        <MuiStep key={index}>
          <MuiStepLabel
            icon={step.icon}
            optional={
              step.optional ? (
                <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)' }}>
                  Optional
                </Typography>
              ) : step.description ? (
                <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)' }}>
                  {step.description}
                </Typography>
              ) : undefined
            }
          >
            {step.label}
          </MuiStepLabel>
        </MuiStep>
      ))}
    </MuiStepper>
  );
}

Stepper.displayName = 'Stepper';
