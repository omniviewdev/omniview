import { type TrivyVulnerability } from '../../types';
import { cvssMapping, vectorMapping } from './definitions';
import { type SortingFn } from '@tanstack/react-table';

export const getSeverityColor = (severity: string) => {
  switch (severity) {
    case 'CRITICAL':
      return 'danger';
    case 'HIGH':
      return 'warning';
    case 'MEDIUM':
      return 'primary';
    case 'LOW':
    default:
      return 'neutral';
  }
};

// Function to sort vulnerabilities by CVSS V3 score
export const sortVulnerabilitiesByCVSS: SortingFn<TrivyVulnerability> = (rowA, rowB, _columnId) => {
  const criticalityMap: Record<string, number> = {
    CRITICAL: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
    UNKNOWN: 0,
  };

  const scoreA = criticalityMap[rowA.original?.Severity ?? 'UNKNOWN'];
  const scoreB = criticalityMap[rowB.original?.Severity ?? 'UNKNOWN'];

  // Handle possible undefined scores by assigning them a low priority
  const scoreANum = scoreA ?? -1;
  const scoreBNum = scoreB ?? -1;

  // Basic ascending sort
  let comparison = 0;
  if (scoreANum > scoreBNum) {
    comparison = 1;
  } else if (scoreANum < scoreBNum) {
    comparison = -1;
  }

  return comparison;
};

export const parseCvssVector = (vector: string) => {
  return vector.split('/').slice(1).map(part => {
    const [metric, value] = part.split(':');
    return {
      metric: vectorMapping[metric],
      value: cvssMapping[metric][value].short,
      description: cvssMapping[metric][value].desc,
    };
  });
};
