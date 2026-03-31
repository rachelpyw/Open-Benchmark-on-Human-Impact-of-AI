// ===== Audience Descriptions & Priority Areas =====

export interface AudienceInfo {
  label: string;
  icon: string;
  description: string;
  priorityAreaIds: string[];
  focusPoints: string[];
}

export const AUDIENCE_INFO: Record<string, AudienceInfo> = {
  generic: {
    label: 'General Population',
    icon: 'fa-users',
    description: '',
    priorityAreaIds: [],
    focusPoints: [],
  },
  student: {
    label: 'Students',
    icon: 'fa-graduation-cap',
    description:
      'Students are especially impacted by AI\'s effects on learning, autonomy, and psychological health. Key concerns include cognitive offloading—letting AI replace active thinking—academic integrity, and whether AI tools foster genuine curiosity or shallow task completion. Examine the Societal and Psychological areas closely.',
    priorityAreaIds: ['self-actualization', 'psychological'],
    focusPoints: ['Learning & Skill Development', 'Autonomy & Critical Thinking', 'Mental Health & Wellbeing'],
  },
  professional: {
    label: 'Professionals',
    icon: 'fa-briefcase',
    description:
      'For professionals, AI reshapes expertise, decision-making, and economic security. Watch for impacts on creativity, occupational autonomy, and the sense of meaning derived from work. Financial security and physical health dimensions also matter as AI transforms labor markets.',
    priorityAreaIds: ['self-actualization', 'physical-safety'],
    focusPoints: ['Work Autonomy & Expertise', 'Creativity & Innovation', 'Financial Security'],
  },
  elderly: {
    label: 'Elderly',
    icon: 'fa-person-cane',
    description:
      'Elderly users are more vulnerable to social isolation, digital dependency, and health misinformation from AI systems. Focus on whether AI strengthens or replaces human connection, supports physical health management, and protects financial security against exploitation.',
    priorityAreaIds: ['physical-safety', 'psychological'],
    focusPoints: ['Social Connection vs. Isolation', 'Physical Health Support', 'Financial Safety & Scams'],
  },
  vulnerable: {
    label: 'Vulnerable Groups',
    icon: 'fa-shield-heart',
    description:
      'Vulnerable populations face amplified risks from poorly designed AI: dependency, exploitation, and psychological harm. Every dimension matters here, but mental health, character formation, and financial security deserve the highest scrutiny. AI can be a lifeline or a harm amplifier.',
    priorityAreaIds: ['psychological', 'physical-safety'],
    focusPoints: ['Mental Health & Crisis Response', 'Financial Security & Exploitation', 'Character & Dignity'],
  },
};
