// Description object for each metric value
type MetricDescription = {
  short: string;
  desc: string;
};

type MetricValueDescriptions = Record<string, MetricDescription>;

type CvssMapping = Record<string, MetricValueDescriptions>;

export const vectorMapping: Record<string, string> = {
  AV: 'Attack Vector',
  AC: 'Attack Complexity',
  PR: 'Privileges Required',
  UI: 'User Interaction',
  S: 'Scope',
  C: 'Confidentiality',
  I: 'Integrity',
  A: 'Availability',
};

export const cvssMapping: CvssMapping = {
  AV: {
    N: {
      short: 'Network',
      desc: 'The vulnerability can be exploited over a network without any user interaction.',
    },
    A: {
      short: 'Adjacent',
      desc: 'The attack can only be launched from a network adjacent to the victim.',
    },
    L: {
      short: 'Local',
      desc: 'The attack is carried out by someone with physical or local access to the vulnerable system.',
    },
    P: {
      short: 'Physical',
      desc: 'The attacker needs to physically touch or manipulate the vulnerable component.',
    },
  },
  AC: {
    L: {
      short: 'Low',
      desc: 'Specialized access conditions or extenuating circumstances do not exist.',
    },
    H: {
      short: 'High',
      desc: 'A successful attack depends on conditions beyond the attacker\'s control.',
    },
  },
  PR: {
    N: {
      short: 'None',
      desc: 'The attacker does not require any privileges to exploit this vulnerability.',
    },
    L: {
      short: 'Low',
      desc: 'The attacker requires privileges that provide basic user capabilities.',
    },
    H: {
      short: 'High',
      desc: 'The attacker requires privileges that provide significant or administrative control.',
    },
  },
  UI: {
    N: {
      short: 'None',
      desc: 'The exploitation of the vulnerability requires no interaction from any user.',
    },
    R: {
      short: 'Required',
      desc: 'Successful exploitation of this vulnerability requires user interaction.',
    },
  },
  S: {
    U: {
      short: 'Unchanged',
      desc: 'An exploited vulnerability can only affect resources managed by the same security authority.',
    },
    C: {
      short: 'Changed',
      desc: 'An exploited vulnerability can affect resources beyond the security scope managed by the authority that is the victim.',
    },
  },
  C: {
    N: {
      short: 'None',
      desc: 'There is no impact to the confidentiality of the system.',
    },
    L: {
      short: 'Low',
      desc: 'There is some loss of confidentiality.',
    },
    H: {
      short: 'High',
      desc: 'There is total loss of confidentiality, allowing access to all protected data.',
    },
  },
  I: {
    N: {
      short: 'None',
      desc: 'There is no impact to integrity.',
    },
    L: {
      short: 'Low',
      desc: 'Modification of some system data or information is possible, but the attacker does not have control over what can be modified.',
    },
    H: {
      short: 'High',
      desc: 'Total compromise of system integrity; the attacker can modify any and all data and system files.',
    },
  },
  A: {
    N: {
      short: 'None',
      desc: 'There is no impact to availability.',
    },
    L: {
      short: 'Low',
      desc: 'There is reduced performance or interruptions in resource availability.',
    },
    H: {
      short: 'High',
      desc: 'There is total shutdown of the affected resource. The resource becomes completely unavailable.',
    },
  },
};
