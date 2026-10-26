import type {
  AppData,
  ApplicationType,
  Assignment,
  Batch,
  Department,
  Faculty,
  Permission,
  Post,
  Profile,
  Section,
  Settings,
  WorkflowVersion,
} from '../domain/types';
import { buildSession } from './session';
import { makeContext } from './ops/context';
import {
  createApplication,
  submitApplication,
  actOnApplication,
} from './ops/applications';
import { saveNotice, publishNotice, markNoticeRead } from './ops/notices';

export const DEMO_PASSWORD = 'Demo@12345';

const DAY = 86_400_000;

function iso(base: number, offsetDays: number): string {
  return new Date(base + offsetDays * DAY).toISOString();
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 3) {
    const c1 = input.charCodeAt(i);
    const c2 = i + 1 < input.length ? input.charCodeAt(i + 1) : NaN;
    const c3 = i + 2 < input.length ? input.charCodeAt(i + 2) : NaN;
    const b1 = c1 >> 2;
    const b2 = ((c1 & 3) << 4) | (Number.isNaN(c2) ? 0 : c2 >> 4);
    const b3 = Number.isNaN(c2) ? 64 : (((c2 & 15) << 2) | (Number.isNaN(c3) ? 0 : c3 >> 6));
    const b4 = Number.isNaN(c3) ? 64 : c3 & 63;
    out += B64[b1] + B64[b2] + (b3 === 64 ? '=' : B64[b3]) + (b4 === 64 ? '=' : B64[b4]);
  }
  return out;
}

const SAMPLE_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 78>>stream
BT /F1 11 Tf 20 70 Td (Demo attachment - not a real record) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;

export const SAMPLE_PDF_DATA_URL = `data:application/pdf;base64,${base64(SAMPLE_PDF)}`;

const ALL_OFFICER_PERMS: Permission[] = [
  'application.submit',
  'application.view',
  'application.act',
  'document.view',
  'statistics.view',
  'notice.create',
];

/**
 * Dean level and above may approve but never apply: senior posts deliberately
 * drop `application.submit`. An administrator can add it back per post in
 * Administration → Posts & permissions.
 */
const SENIOR_PERMS: Permission[] = ALL_OFFICER_PERMS.filter((p) => p !== 'application.submit');

function posts(): Post[] {
  const mk = (
    code: string,
    name: string,
    scope_type: Post['scope_type'],
    rank: number,
    permissions: Permission[],
    description: string,
  ): Post => ({ code, name, scope_type, rank, permissions, is_system: true, active: true, description });

  return [
    mk('MENTOR', 'Mentor', 'section', 10, ALL_OFFICER_PERMS, 'Class mentor for an assigned section.'),
    mk('HOD', 'Head of Department', 'department', 20, ALL_OFFICER_PERMS, 'Head of an assigned department.'),
    mk('DEAN', 'Dean', 'faculty', 30, SENIOR_PERMS, 'Dean of an assigned faculty. Approves but never applies.'),
    mk('REGISTRAR', 'Registrar', 'university', 40, SENIOR_PERMS, 'University registrar. Approves but never applies.'),
    mk('HR_OFFICER', 'HR Officer', 'university', 25, ALL_OFFICER_PERMS, 'Processes staff claims and HR requests.'),
    mk('PVC', 'Pro-Vice-Chancellor', 'university', 50, SENIOR_PERMS, 'Pro-Vice-Chancellor. Approves but never applies.'),
    mk(
      'VC',
      'Vice-Chancellor',
      'university',
      60,
      [...SENIOR_PERMS, 'notice.university', 'audit.view'],
      'Vice-Chancellor — final university authority unless a post above is configured. Approves but never applies.',
    ),
    mk(
      'CHANCELLOR',
      'Chancellor',
      'university',
      70,
      [
        'application.view',
        'application.act',
        'document.view',
        'statistics.view',
        'notice.create',
        'notice.university',
        'audit.view',
      ],
      'Custom post above the VC (demonstrates configurable higher authority). Approves but never applies.',
    ),
    mk(
      'WORKFLOW_ADMIN',
      'Workflow Administrator',
      'university',
      80,
      [
        'user.manage',
        'workflow.configure',
        'retention.manage',
        'audit.view',
        'statistics.view',
        'notice.create',
        'notice.university',
      ],
      'University administrator for structure, accounts and workflows.',
    ),
    mk(
      'SYSADMIN',
      'System Administrator',
      'university',
      90,
      ['system.admin', 'user.manage', 'workflow.configure', 'audit.view', 'retention.manage', 'statistics.view'],
      'System administration. Deliberately has no access to application contents.',
    ),
    mk(
      'AUDITOR',
      'Compliance Auditor (read-only)',
      'university',
      5,
      ['audit.view', 'statistics.view'],
      'Read-only auditor. No access to application contents or documents.',
    ),
  ];
}

const settings = (): Settings => ({
  university_name: 'SGT University',
  university_short: 'SGTU',
  support_email: 'support@demo.university',
  timezone: 'Asia/Kolkata',
  seed_data: true,
  retention_months: 12,
  final_retention_months: 6,
  mfa_required_for_privileged: false,
  allow_self_registration: false,
});

function org(): {
  faculties: Faculty[];
  departments: Department[];
  batches: Batch[];
  sections: Section[];
  now: string;
} {
  const now = new Date().toISOString();
  // SGT University's 19 faculties/schools. These are seed defaults only — every
  // one of them (plus their departments) can be renamed, added to or archived from
  // Administration → Organisation, and no application logic depends on the list.
  const faculties: Faculty[] = [
    { id: 'fac_med', name: 'Faculty of Medicine & Health Sciences', code: 'MED', active: true, archived: false },
    { id: 'fac_dent', name: 'Faculty of Dental Sciences', code: 'DENT', active: true, archived: false },
    { id: 'fac_ayur', name: 'Faculty of Indian Medical System (Ayurveda)', code: 'AYUR', active: true, archived: false },
    { id: 'fac_nurs', name: 'Faculty of Nursing', code: 'NURS', active: true, archived: false },
    { id: 'fac_pharm', name: 'Faculty of Pharmacy', code: 'PHARM', active: true, archived: false },
    { id: 'fac_ahs', name: 'Faculty of Allied Health Sciences', code: 'AHS', active: true, archived: false },
    { id: 'fac_physio', name: 'Faculty of Physiotherapy', code: 'PHYSIO', active: true, archived: false },
    { id: 'fac_naturo', name: 'Faculty of Naturopathy & Yogic Sciences', code: 'NATURO', active: true, archived: false },
    { id: 'fac_behav', name: 'Faculty of Behavioural Sciences', code: 'BEHAV', active: true, archived: false },
    { id: 'fac_agri', name: 'Faculty of Agricultural Sciences', code: 'AGRI', active: true, archived: false },
    { id: 'fac_sci', name: 'Faculty of Basic & Applied Sciences', code: 'BAS', active: true, archived: false },
    { id: 'fac_eng', name: 'Faculty of Engineering & Technology', code: 'ENG', active: true, archived: false },
    { id: 'fac_com', name: 'School of Commerce & Management', code: 'COM', active: true, archived: false },
    { id: 'fac_law', name: 'Faculty of Law', code: 'LAW', active: true, archived: false },
    { id: 'fac_edu', name: 'Faculty of Education', code: 'EDU', active: true, archived: false },
    { id: 'fac_design', name: 'School of Design', code: 'DESIGN', active: true, archived: false },
    { id: 'fac_htm', name: 'School of Hotel & Tourism Management', code: 'HTM', active: true, archived: false },
    { id: 'fac_emc', name: 'School of Emerging Media, Communication & Film Studies', code: 'EMC', active: true, archived: false },
    { id: 'fac_hum', name: 'School of Humanities, Social Sciences & Liberal Arts', code: 'HUM', active: true, archived: false },
  ];

  const departments: Department[] = [
    // Engineering & Technology
    { id: 'dep_cse', faculty_id: 'fac_eng', name: 'Computer Science & Engineering', code: 'CSE', active: true, archived: false },
    { id: 'dep_ece', faculty_id: 'fac_eng', name: 'Electronics & Communication', code: 'ECE', active: true, archived: false },
    { id: 'dep_mech', faculty_id: 'fac_eng', name: 'Mechanical Engineering', code: 'ME', active: true, archived: false },
    { id: 'dep_civil', faculty_id: 'fac_eng', name: 'Civil Engineering', code: 'CE', active: true, archived: false },
    // Basic & Applied Sciences
    { id: 'dep_phy', faculty_id: 'fac_sci', name: 'Physics', code: 'PHY', active: true, archived: false },
    { id: 'dep_chem', faculty_id: 'fac_sci', name: 'Chemistry', code: 'CHEM', active: true, archived: false },
    { id: 'dep_math', faculty_id: 'fac_sci', name: 'Mathematics', code: 'MATH', active: true, archived: false },
    { id: 'dep_forensic', faculty_id: 'fac_sci', name: 'Forensic Science', code: 'FOR', active: true, archived: false },
    // Medicine & Health Sciences
    { id: 'dep_gmed', faculty_id: 'fac_med', name: 'General Medicine', code: 'GMED', active: true, archived: false },
    { id: 'dep_surg', faculty_id: 'fac_med', name: 'General Surgery', code: 'SURG', active: true, archived: false },
    { id: 'dep_paed', faculty_id: 'fac_med', name: 'Paediatrics', code: 'PAED', active: true, archived: false },
    // Dental Sciences
    { id: 'dep_cons', faculty_id: 'fac_dent', name: 'Conservative Dentistry & Endodontics', code: 'CONS', active: true, archived: false },
    { id: 'dep_oms', faculty_id: 'fac_dent', name: 'Oral & Maxillofacial Surgery', code: 'OMS', active: true, archived: false },
    // Ayurveda
    { id: 'dep_ayur_samhita', faculty_id: 'fac_ayur', name: 'Ayurveda Samhita', code: 'ASAM', active: true, archived: false },
    { id: 'dep_shalya', faculty_id: 'fac_ayur', name: 'Shalya Tantra', code: 'SHAL', active: true, archived: false },
    // Nursing
    { id: 'dep_nurs', faculty_id: 'fac_nurs', name: 'Nursing', code: 'NUR', active: true, archived: false },
    { id: 'dep_comm_nurs', faculty_id: 'fac_nurs', name: 'Community Health Nursing', code: 'CHN', active: true, archived: false },
    // Pharmacy
    { id: 'dep_pharm', faculty_id: 'fac_pharm', name: 'Pharmaceutics', code: 'PHM', active: true, archived: false },
    { id: 'dep_pharm_prac', faculty_id: 'fac_pharm', name: 'Pharmacy Practice', code: 'PHR', active: true, archived: false },
    // Allied Health Sciences
    { id: 'dep_mlt', faculty_id: 'fac_ahs', name: 'Medical Laboratory Technology', code: 'MLT', active: true, archived: false },
    { id: 'dep_optom', faculty_id: 'fac_ahs', name: 'Optometry', code: 'OPTO', active: true, archived: false },
    { id: 'dep_rad', faculty_id: 'fac_ahs', name: 'Radio-Imaging Technology', code: 'RAD', active: true, archived: false },
    // Physiotherapy
    { id: 'dep_physio', faculty_id: 'fac_physio', name: 'Physiotherapy', code: 'PHT', active: true, archived: false },
    { id: 'dep_sports', faculty_id: 'fac_physio', name: 'Sports & Exercise Sciences', code: 'SES', active: true, archived: false },
    // Naturopathy & Yogic Sciences
    { id: 'dep_naturo', faculty_id: 'fac_naturo', name: 'Naturopathy', code: 'NAT', active: true, archived: false },
    { id: 'dep_yoga', faculty_id: 'fac_naturo', name: 'Yogic Sciences', code: 'YOG', active: true, archived: false },
    // Behavioural Sciences
    { id: 'dep_psych', faculty_id: 'fac_behav', name: 'Psychology', code: 'PSY', active: true, archived: false },
    { id: 'dep_couns', faculty_id: 'fac_behav', name: 'Counselling', code: 'CNS', active: true, archived: false },
    // Agricultural Sciences
    { id: 'dep_agron', faculty_id: 'fac_agri', name: 'Agronomy', code: 'AGR', active: true, archived: false },
    { id: 'dep_plant', faculty_id: 'fac_agri', name: 'Plant Pathology', code: 'PLP', active: true, archived: false },
    // Commerce & Management
    { id: 'dep_mgmt', faculty_id: 'fac_com', name: 'Management', code: 'MGT', active: true, archived: false },
    { id: 'dep_comm', faculty_id: 'fac_com', name: 'Commerce', code: 'COM', active: true, archived: false },
    // Law
    { id: 'dep_law', faculty_id: 'fac_law', name: 'Law', code: 'LAW', active: true, archived: false },
    { id: 'dep_legal', faculty_id: 'fac_law', name: 'Legal Studies', code: 'LEG', active: true, archived: false },
    // Education
    { id: 'dep_edu', faculty_id: 'fac_edu', name: 'Education', code: 'EDU', active: true, archived: false },
    { id: 'dep_spl_edu', faculty_id: 'fac_edu', name: 'Special Education', code: 'SPL', active: true, archived: false },
    // Design
    { id: 'dep_fashion', faculty_id: 'fac_design', name: 'Fashion Design', code: 'FD', active: true, archived: false },
    { id: 'dep_comm_design', faculty_id: 'fac_design', name: 'Communication Design', code: 'CD', active: true, archived: false },
    // Hotel & Tourism
    { id: 'dep_hotel', faculty_id: 'fac_htm', name: 'Hotel Management', code: 'HM', active: true, archived: false },
    { id: 'dep_tourism', faculty_id: 'fac_htm', name: 'Tourism', code: 'TUR', active: true, archived: false },
    // Emerging Media
    { id: 'dep_jmc', faculty_id: 'fac_emc', name: 'Journalism & Mass Communication', code: 'JMC', active: true, archived: false },
    { id: 'dep_film', faculty_id: 'fac_emc', name: 'Film Studies', code: 'FILM', active: true, archived: false },
    // Humanities
    { id: 'dep_english', faculty_id: 'fac_hum', name: 'English', code: 'ENG', active: true, archived: false },
    { id: 'dep_polsci', faculty_id: 'fac_hum', name: 'Political Science', code: 'POL', active: true, archived: false },
    { id: 'dep_liberal', faculty_id: 'fac_hum', name: 'Liberal Arts', code: 'LAR', active: true, archived: false },
  ];
  const batches: Batch[] = [
    {
      id: 'bat_cse_2024',
      department_id: 'dep_cse',
      label: 'CSE 2024–2028',
      start_year: 2024,
      end_year: 2028,
      status: 'active',
      retention_months: 12,
      final_months: 6,
      graduated_on: null,
      archived_on: null,
      created_at: now,
    },
    {
      id: 'bat_cse_2023',
      department_id: 'dep_cse',
      label: 'CSE 2023–2027',
      start_year: 2023,
      end_year: 2027,
      status: 'active',
      retention_months: 12,
      final_months: 6,
      graduated_on: null,
      archived_on: null,
      created_at: now,
    },
    {
      id: 'bat_ece_2024',
      department_id: 'dep_ece',
      label: 'ECE 2024–2028',
      start_year: 2024,
      end_year: 2028,
      status: 'active',
      retention_months: 12,
      final_months: 6,
      graduated_on: null,
      archived_on: null,
      created_at: now,
    },
    {
      id: 'bat_cse_2020',
      department_id: 'dep_cse',
      label: 'CSE 2020–2024',
      start_year: 2020,
      end_year: 2024,
      status: 'graduated',
      retention_months: 12,
      final_months: 6,
      graduated_on: iso(Date.now(), -400),
      archived_on: null,
      created_at: now,
    },
  ];
  const sections: Section[] = [
    { id: 'sec_cse24_a', batch_id: 'bat_cse_2024', name: 'A', capacity: 60 },
    { id: 'sec_cse24_b', batch_id: 'bat_cse_2024', name: 'B', capacity: 60 },
    { id: 'sec_cse23_a', batch_id: 'bat_cse_2023', name: 'A', capacity: 60 },
    { id: 'sec_ece24_a', batch_id: 'bat_ece_2024', name: 'A', capacity: 60 },
    { id: 'sec_cse20_a', batch_id: 'bat_cse_2020', name: 'A', capacity: 60 },
  ];
  return { faculties, departments, batches, sections, now };
}

function people(): Profile[] {
  const staff = (
    id: string,
    code: string,
    name: string,
    email: string,
    dept: string,
    designation: string,
  ): Profile => ({
    id,
    user_code: code,
    full_name: name,
    email,
    kind: 'teacher',
    status: 'active',
    phone: null,
    designation,
    department_id: null,
    batch_id: null,
    section_id: null,
    roll_no: null,
    home_department_id: dept,
    joined_on: '2021-07-01',
    last_login_at: null,
  });
  const student = (
    id: string,
    code: string,
    name: string,
    email: string,
    dept: string,
    batch: string,
    section: string,
    roll: string,
  ): Profile => ({
    id,
    user_code: code,
    full_name: name,
    email,
    kind: 'student',
    status: 'active',
    phone: null,
    designation: null,
    department_id: dept,
    batch_id: batch,
    section_id: section,
    roll_no: roll,
    home_department_id: null,
    joined_on: '2024-08-01',
    last_login_at: null,
  });

  return [
    staff('usr_sysadmin', 'SYS0001', 'Rohit Malhotra', 'sysadmin@demo.university', 'dep_cse', 'System Administrator'),
    staff('usr_wfadmin', 'ADM0001', 'Neha Bansal', 'wfadmin@demo.university', 'dep_cse', 'University Administrator'),
    staff('usr_vc', 'VC0001', 'Prof. Anjali Deshmukh', 'vc@demo.university', 'dep_cse', 'Vice-Chancellor'),
    staff('usr_pvc', 'PVC0001', 'Prof. Balraj Nair', 'pvc@demo.university', 'dep_cse', 'Pro-Vice-Chancellor'),
    staff('usr_chancellor', 'CHN0001', 'Dr. Chandra Rao', 'chancellor@demo.university', 'dep_cse', 'Chancellor'),
    staff('usr_registrar', 'REG0001', 'Ms. Deepa Iyer', 'registrar@demo.university', 'dep_cse', 'Registrar'),
    staff('usr_dean_eng', 'DEAN0001', 'Prof. Eshan Kapoor', 'dean.eng@demo.university', 'dep_cse', 'Dean, Engineering & Technology'),
    staff('usr_dean_sci', 'DEAN0002', 'Prof. Farah Siddiqui', 'dean.sci@demo.university', 'dep_phy', 'Dean, Basic & Applied Sciences'),
    staff('usr_hod_cse', 'HOD0001', 'Dr. Gita Menon', 'hod.cse@demo.university', 'dep_cse', 'Head, CSE'),
    staff('usr_hod_ece', 'HOD0002', 'Dr. Harish Patel', 'hod.ece@demo.university', 'dep_ece', 'Head, ECE'),
    staff('usr_mentor_a', 'FAC0001', 'Dr. Ira Sharma', 'mentor.a@demo.university', 'dep_cse', 'Assistant Professor & Mentor'),
    staff('usr_mentor_b', 'FAC0002', 'Dr. Jatin Verma', 'mentor.b@demo.university', 'dep_cse', 'Assistant Professor & Mentor'),
    staff('usr_mentor_ece', 'FAC0003', 'Dr. Kavya Reddy', 'mentor.ece@demo.university', 'dep_ece', 'Assistant Professor & Mentor'),
    staff('usr_teacher', 'FAC0004', 'Dr. Lata Joshi', 'teacher@demo.university', 'dep_cse', 'Associate Professor'),
    staff('usr_former_hod', 'FAC0005', 'Dr. Manoj Tiwari', 'former.hod@demo.university', 'dep_cse', 'Professor'),
    staff('usr_auditor', 'AUD0001', 'Mr. Nikhil Menon', 'auditor@demo.university', 'dep_cse', 'Compliance Reviewer'),
    student('usr_student_a', 'STU0001', 'Aarav Mehta', 'student.a@demo.university', 'dep_cse', 'bat_cse_2024', 'sec_cse24_a', 'CSE/24/A/001'),
    student('usr_student_b', 'STU0002', 'Bhavna Kulkarni', 'student.b@demo.university', 'dep_cse', 'bat_cse_2024', 'sec_cse24_a', 'CSE/24/A/002'),
    student('usr_student_c', 'STU0003', 'Chirag Anand', 'student.c@demo.university', 'dep_cse', 'bat_cse_2024', 'sec_cse24_b', 'CSE/24/B/001'),
    student('usr_student_ece', 'STU0004', 'Divya Rane', 'student.ece@demo.university', 'dep_ece', 'bat_ece_2024', 'sec_ece24_a', 'ECE/24/A/001'),
  ];
}

function assignments(base: number): Assignment[] {
  const at = iso(base, -300);
  const mk = (
    id: string,
    user_id: string,
    post_code: string,
    scope: Assignment['scope'],
    reason = 'Initial appointment (demo data)',
  ): Assignment => ({
    id,
    user_id,
    post_code,
    scope,
    starts_at: at,
    ends_at: null,
    active: true,
    created_by: 'usr_sysadmin',
    reason,
    created_at: at,
  });

  return [
    mk('asg_sysadmin', 'usr_sysadmin', 'SYSADMIN', {}),
    mk('asg_wfadmin', 'usr_wfadmin', 'WORKFLOW_ADMIN', {}),
    mk('asg_vc', 'usr_vc', 'VC', {}),
    mk('asg_pvc', 'usr_pvc', 'PVC', {}),
    mk('asg_chancellor', 'usr_chancellor', 'CHANCELLOR', {}),
    mk('asg_registrar', 'usr_registrar', 'REGISTRAR', {}),
    mk('asg_dean_eng', 'usr_dean_eng', 'DEAN', { faculty_id: 'fac_eng' }),
    mk('asg_dean_sci', 'usr_dean_sci', 'DEAN', { faculty_id: 'fac_sci' }),
    mk('asg_hod_cse', 'usr_hod_cse', 'HOD', { faculty_id: 'fac_eng', department_id: 'dep_cse' }),
    mk('asg_hod_ece', 'usr_hod_ece', 'HOD', { faculty_id: 'fac_eng', department_id: 'dep_ece' }),
    mk('asg_mentor_a', 'usr_mentor_a', 'MENTOR', {
      faculty_id: 'fac_eng',
      department_id: 'dep_cse',
      batch_id: 'bat_cse_2024',
      section_id: 'sec_cse24_a',
    }),
    mk('asg_mentor_b', 'usr_mentor_b', 'MENTOR', {
      faculty_id: 'fac_eng',
      department_id: 'dep_cse',
      batch_id: 'bat_cse_2024',
      section_id: 'sec_cse24_b',
    }),
    mk('asg_mentor_ece', 'usr_mentor_ece', 'MENTOR', {
      faculty_id: 'fac_eng',
      department_id: 'dep_ece',
      batch_id: 'bat_ece_2024',
      section_id: 'sec_ece24_a',
    }),
    mk('asg_auditor', 'usr_auditor', 'AUDITOR', {}),
    // Historical assignment: demonstrates that ended assignments revoke access
    // while the post history stays with the post.
    {
      ...mk('asg_former_hod', 'usr_former_hod', 'HOD', { faculty_id: 'fac_eng', department_id: 'dep_cse' }, 'Previous Head of Department'),
      starts_at: iso(base, -300),
      ends_at: iso(base, -250),
      active: false,
      ended_by: 'usr_sysadmin',
      ended_reason: 'Handover to Dr. Gita Menon (demo data)',
    },
  ];
}

function applicationTypes(): ApplicationType[] {
  const now = new Date().toISOString();
  const mk = (partial: Omit<ApplicationType, 'id' | 'created_at' | 'version' | 'active'> & { id: string }): ApplicationType => ({
    ...partial,
    active: true,
    version: 1,
    created_at: now,
  });

  return [
    mk({
      id: 'at_student_leave',
      code: 'STUDENT_LEAVE',
      name: 'Leave request (student)',
      description: 'Request leave from classes with mentor and department approval.',
      applicant_kinds: ['student'],
      confidential: false,
      allow_draft: true,
      allow_withdraw: true,
      retention_category: 'standard',
      extra_viewer_posts: [],
      fallback_approver_post: 'HOD',
      fields: [
        {
          key: 'leave_type',
          label: 'Leave type',
          type: 'select',
          required: true,
          options: ['Medical', 'Family function', 'Official duty', 'Other'],
        },
        { key: 'from_date', label: 'From date', type: 'date', required: true },
        { key: 'to_date', label: 'To date', type: 'date', required: true },
        { key: 'reason', label: 'Reason for leave', type: 'textarea', required: true, max_length: 2000 },
        { key: 'contact', label: 'Contact number during leave', type: 'text', required: false, max_length: 20 },
      ],
      documents: [
        {
          key: 'supporting',
          label: 'Supporting document (medical certificate, if any)',
          required: false,
          accept: ['application/pdf', 'image/png', 'image/jpeg'],
          max_mb: 2,
        },
      ],
    }),
    mk({
      id: 'at_bonafide',
      code: 'BONAFIDE',
      name: 'Bonafide certificate request',
      description: 'Request a bonafide study certificate from the mentor.',
      applicant_kinds: ['student'],
      confidential: false,
      allow_draft: true,
      allow_withdraw: true,
      retention_category: 'standard',
      extra_viewer_posts: [],
      fallback_approver_post: 'HOD',
      fields: [
        { key: 'purpose', label: 'Purpose of the certificate', type: 'textarea', required: true, max_length: 1000 },
        { key: 'needed_by', label: 'Needed by', type: 'date', required: false },
      ],
      documents: [],
    }),
    mk({
      id: 'at_faculty_leave',
      code: 'FACULTY_LEAVE',
      name: 'Faculty leave / duty leave',
      description: 'Staff leave routed through HOD, Dean and Vice-Chancellor. Uses the configured post above the VC.',
      applicant_kinds: ['teacher', 'staff'],
      confidential: false,
      allow_draft: true,
      allow_withdraw: true,
      retention_category: 'standard',
      extra_viewer_posts: [],
      fallback_approver_post: 'REGISTRAR',
      fields: [
        {
          key: 'leave_type',
          label: 'Leave type',
          type: 'select',
          required: true,
          options: ['Casual leave', 'Duty leave', 'Medical leave', 'Conference / seminar'],
        },
        { key: 'from_date', label: 'From date', type: 'date', required: true },
        { key: 'to_date', label: 'To date', type: 'date', required: true },
        { key: 'reason', label: 'Reason', type: 'textarea', required: true, max_length: 2000 },
        { key: 'substitute', label: 'Substitute arrangements', type: 'text', required: false, max_length: 200 },
      ],
      documents: [
        {
          key: 'supporting',
          label: 'Supporting document (optional)',
          required: false,
          accept: ['application/pdf', 'image/png', 'image/jpeg'],
          max_mb: 2,
        },
      ],
    }),
    mk({
      id: 'at_reimbursement',
      code: 'STAFF_REIMBURSEMENT',
      name: 'Reimbursement claim (staff)',
      description: 'Claim approved expenses. Receipt is mandatory.',
      applicant_kinds: ['teacher', 'staff'],
      confidential: false,
      allow_draft: true,
      allow_withdraw: false,
      retention_category: 'financial',
      extra_viewer_posts: ['HR_OFFICER'],
      fallback_approver_post: 'REGISTRAR',
      fields: [
        { key: 'amount', label: 'Amount (INR)', type: 'number', required: true },
        { key: 'incurred_on', label: 'Expense date', type: 'date', required: true },
        { key: 'purpose', label: 'Purpose', type: 'textarea', required: true, max_length: 1000 },
        { key: 'bank_ref', label: 'Bank reference (optional)', type: 'text', required: false, max_length: 40 },
      ],
      documents: [
        {
          key: 'receipt',
          label: 'Receipt / invoice',
          required: true,
          accept: ['application/pdf', 'image/png', 'image/jpeg'],
          max_mb: 2,
        },
      ],
    }),
    mk({
      id: 'at_other',
      code: 'OTHER_REQUEST',
      name: 'Other request (write your own subject)',
      description:
        'Anything not covered by the standard forms. Write your own subject and explain what you need — students go to the mentor, staff to the head of department.',
      applicant_kinds: ['student', 'teacher', 'staff'],
      confidential: false,
      allow_draft: true,
      allow_withdraw: true,
      retention_category: 'standard',
      extra_viewer_posts: [],
      fallback_approver_post: 'DEAN',
      fields: [
        {
          key: 'subject',
          label: 'Subject',
          type: 'text',
          required: true,
          max_length: 160,
          help: 'Write the subject in your own words — anything is fine.',
        },
        { key: 'details', label: 'Describe your request', type: 'textarea', required: true, max_length: 4000 },
        { key: 'needed_by', label: 'Needed by (optional)', type: 'date', required: false },
      ],
      documents: [
        {
          key: 'supporting',
          label: 'Supporting document (optional)',
          required: false,
          accept: ['application/pdf', 'image/png', 'image/jpeg'],
          max_mb: 2,
        },
      ],
    }),
    mk({
      id: 'at_grievance',
      code: 'EXAM_GRIEVANCE',
      name: 'Examination grievance (confidential)',
      description:
        'Confidential grievance. Only the officer currently required to act on it can read the details; the system administrator cannot.',
      applicant_kinds: ['student'],
      confidential: true,
      allow_draft: true,
      allow_withdraw: false,
      retention_category: 'disciplinary',
      extra_viewer_posts: [],
      fallback_approver_post: 'REGISTRAR',
      fields: [
        { key: 'subject', label: 'Subject', type: 'text', required: true, max_length: 160 },
        { key: 'details', label: 'What happened?', type: 'textarea', required: true, max_length: 4000 },
        { key: 'consent', label: 'I understand this is handled confidentially', type: 'checkbox', required: true },
      ],
      documents: [
        {
          key: 'marksheet',
          label: 'Marksheet / evidence',
          required: true,
          accept: ['application/pdf', 'image/png', 'image/jpeg'],
          max_mb: 2,
        },
      ],
    }),
  ];
}

function workflows(): WorkflowVersion[] {
  const now = new Date().toISOString();
  const mk = (
    id: string,
    typeId: string,
    stages: { key: string; post_code: string; label: string; optional?: boolean }[],
    beyond: WorkflowVersion['beyond_final'] = null,
  ): WorkflowVersion => ({
    id,
    application_type_id: typeId,
    version: 1,
    stages: stages.map((s) => ({ ...s, optional: s.optional ?? false })),
    beyond_final: beyond,
    status: 'active',
    notes: null,
    created_by: 'usr_wfadmin',
    created_at: now,
  });

  return [
    mk('wf_student_leave', 'at_student_leave', [
      { key: 'mentor', post_code: 'MENTOR', label: 'Mentor review' },
      { key: 'hod', post_code: 'HOD', label: 'Head of Department' },
    ]),
    mk('wf_bonafide', 'at_bonafide', [{ key: 'mentor', post_code: 'MENTOR', label: 'Mentor review' }]),
    // Students: mentor → HOD. Staff applications have no section, so the mentor
    // stage is not applicable and is skipped automatically (see workflow.ts).
    mk('wf_other', 'at_other', [
      { key: 'mentor', post_code: 'MENTOR', label: 'Mentor review', optional: true },
      { key: 'hod', post_code: 'HOD', label: 'Head of Department' },
    ]),
    mk(
      'wf_faculty_leave',
      'at_faculty_leave',
      [
        { key: 'hod', post_code: 'HOD', label: 'Head of Department' },
        { key: 'dean', post_code: 'DEAN', label: 'Dean' },
        { key: 'vc', post_code: 'VC', label: 'Vice-Chancellor' },
      ],
      {
        post_code: 'CHANCELLOR',
        label: 'Chancellor (post above the VC)',
        actions: ['finalise', 'reject', 'return'],
      },
    ),
    mk('wf_reimbursement', 'at_reimbursement', [
      { key: 'hod', post_code: 'HOD', label: 'Head of Department' },
      { key: 'registrar', post_code: 'REGISTRAR', label: 'Registrar' },
    ]),
    mk('wf_grievance', 'at_grievance', [
      { key: 'mentor', post_code: 'MENTOR', label: 'Mentor review' },
      { key: 'hod', post_code: 'HOD', label: 'Head of Department' },
      { key: 'dean', post_code: 'DEAN', label: 'Dean' },
      { key: 'vc', post_code: 'VC', label: 'Vice-Chancellor' },
    ]),
  ];
}

function seedDocument(data: AppData, appId: string, key: string, name: string, size: number, uploadedBy: string, at: string) {
  data.documents.push({
    id: `dc_${appId}_${key}`,
    application_id: appId,
    notice_id: null,
    doc_key: key,
    file_name: name,
    mime: 'application/pdf',
    size,
    storage_path: `applications/${uploadedBy}/${appId}/seed_${key}`,
    inline_data: SAMPLE_PDF_DATA_URL,
    uploaded_by: uploadedBy,
    uploaded_at: at,
    replaces_id: null,
  });
}

/** Builds a complete, internally consistent demo data set. */
export function createSeedData(): AppData {
  const base = Date.now();
  const nowIso = new Date(base).toISOString();
  const o = org();

  const data: AppData = {
    profiles: people(),
    faculties: o.faculties,
    departments: o.departments,
    batches: o.batches,
    sections: o.sections,
    posts: posts(),
    assignments: assignments(base),
    applicationTypes: applicationTypes(),
    workflows: workflows(),
    applications: [],
    actions: [],
    statusEvents: [],
    documents: [],
    notifications: [],
    notices: [],
    noticeReads: [],
    audit: [],
    retentionJobs: [],
    legalHolds: [],
    deletionAudits: [],
    settings: settings(),
  };

  const profileOf = (id: string): Profile => {
    const p = data.profiles.find((x) => x.id === id);
    if (!p) throw new Error(`seed: missing profile ${id}`);
    return p;
  };
  const ctxFor = (userId: string, at: string) => {
    const session = buildSession(data, profileOf(userId), at);
    return makeContext(data, session, at);
  };

  /* ------------------------------------------------------------- notices */
  const vcCtx = ctxFor('usr_vc', iso(base, -6));
  const uniNotice = saveNotice(vcCtx, {
    title: 'Fee payment window for the new academic year',
    body:
      'The fee payment window is open for all students.\n\nPay through the university payment portal and keep the receipt. Students facing a genuine difficulty should contact the finance office before the closing date.\n\n(This is demo content for the prototype.)',
    scope_type: 'university',
    scope: {},
    audience: 'students',
    status: 'draft',
  });
  uniNotice.publish_at = iso(base, -6);
  publishNotice(vcCtx, uniNotice.id);

  const hodCtx = ctxFor('usr_hod_cse', iso(base, -4));
  const deptNotice = saveNotice(hodCtx, {
    title: 'Department seminar: research opportunities for undergraduates',
    body:
      'A department seminar will be held this Thursday at 3 pm in the CSE seminar hall.\n\nAll students of the department are encouraged to attend. Attendance will be recorded.',
    scope_type: 'department',
    scope: { faculty_id: 'fac_eng', department_id: 'dep_cse' },
    audience: 'students',
    status: 'draft',
  });
  deptNotice.publish_at = iso(base, -4);
  publishNotice(hodCtx, deptNotice.id);

  const mentorCtx = ctxFor('usr_mentor_a', iso(base, -2));
  const sectionNotice = saveNotice(mentorCtx, {
    title: 'Lab session moved to Friday',
    body: 'The Wednesday lab session is moved to Friday 10 am. Bring your lab manual.',
    scope_type: 'section',
    scope: {
      faculty_id: 'fac_eng',
      department_id: 'dep_cse',
      batch_id: 'bat_cse_2024',
      section_id: 'sec_cse24_a',
    },
    audience: 'students',
    status: 'draft',
  });
  sectionNotice.publish_at = iso(base, -2);
  publishNotice(mentorCtx, sectionNotice.id);

  saveNotice(hodCtx, {
    title: 'Draft: internal review meeting agenda',
    body: 'Draft agenda for the internal review meeting. Not published yet.',
    scope_type: 'department',
    scope: { faculty_id: 'fac_eng', department_id: 'dep_cse' },
    audience: 'staff',
    status: 'draft',
  });

  /* -------------------------------------------------------- applications */
  // 1) Student A — leave request, completed through mentor and HOD.
  const s1 = ctxFor('usr_student_a', iso(base, -20));
  const leaveA = createApplication(s1, 'at_student_leave', {
    leave_type: 'Medical',
    from_date: iso(base, -18).slice(0, 10),
    to_date: iso(base, -17).slice(0, 10),
    reason: 'Viral fever with doctor-advised rest for two days.',
    contact: '+91 90000 00001',
  });
  seedDocument(data, leaveA.id, 'supporting', 'medical-certificate.pdf', 690, 'usr_student_a', iso(base, -20));
  submitApplication(s1, leaveA.id);

  actOnApplication(ctxFor('usr_mentor_a', iso(base, -19)), leaveA.id, {
    action: 'approve',
    remarksApplicant: 'Get well soon. Forwarded to the department for record.',
  });
  actOnApplication(ctxFor('usr_hod_cse', iso(base, -18)), leaveA.id, {
    action: 'finalise',
    remarksApplicant: 'Leave approved. Please inform the class representative.',
    remarksInternal: 'Attendance record updated offline.',
  });

  // 2) Student A — bonafide certificate, completed by mentor.
  const s1b = ctxFor('usr_student_a', iso(base, -12));
  const bonafide = createApplication(s1b, 'at_bonafide', {
    purpose: 'Required by the bank for an education loan renewal.',
    needed_by: iso(base, -6).slice(0, 10),
  });
  submitApplication(s1b, bonafide.id);
  actOnApplication(ctxFor('usr_mentor_a', iso(base, -11)), bonafide.id, {
    action: 'finalise',
    remarksApplicant: 'Certificate prepared. Collect from the department office.',
  });

  // 3) Student B — leave pending with the mentor.
  const s2 = ctxFor('usr_student_b', iso(base, -2));
  const leaveB = createApplication(s2, 'at_student_leave', {
    leave_type: 'Family function',
    from_date: iso(base, 1).slice(0, 10),
    to_date: iso(base, 3).slice(0, 10),
    reason: 'Sister’s wedding at home town; travelling by train.',
    contact: '+91 90000 00002',
  });
  submitApplication(s2, leaveB.id);

  // 4) Faculty leave — HOD and Dean approved, VC approved and forwarded to the
  //    configured post above the VC (Chancellor). Still not finally approved.
  const facCtx = ctxFor('usr_teacher', iso(base, -9));
  const facLeave = createApplication(facCtx, 'at_faculty_leave', {
    leave_type: 'Conference / seminar',
    from_date: iso(base, 5).slice(0, 10),
    to_date: iso(base, 7).slice(0, 10),
    reason: 'Presenting a paper at the national conference on distributed systems.',
    substitute: 'Dr. I. Mentor will handle the two lectures.',
  });
  submitApplication(facCtx, facLeave.id);
  actOnApplication(ctxFor('usr_hod_cse', iso(base, -8)), facLeave.id, {
    action: 'approve',
    remarksApplicant: 'Recommended. Please share the conference schedule.',
  });
  actOnApplication(ctxFor('usr_dean_eng', iso(base, -7)), facLeave.id, {
    action: 'approve',
    remarksInternal: 'Department load is covered.',
  });
  actOnApplication(ctxFor('usr_vc', iso(base, -6)), facLeave.id, {
    action: 'approve_forward',
    remarksApplicant: 'Approved. The Chancellor’s office will confirm the final approval.',
    remarksInternal: 'Budget head available for one conference per faculty per year.',
  });

  // 5) Staff reimbursement — receipt attached, pending with the HOD.
  const reimbCtx = ctxFor('usr_teacher', iso(base, -4));
  const claim = createApplication(reimbCtx, 'at_reimbursement', {
    amount: '4850',
    incurred_on: iso(base, -10).slice(0, 10),
    purpose: 'Registration fee for the national conference (approved travel).',
    bank_ref: 'UTR 4455667788',
  });
  seedDocument(data, claim.id, 'receipt', 'conference-receipt.pdf', 1240, 'usr_teacher', iso(base, -4));
  submitApplication(reimbCtx, claim.id);

  // 6) Confidential grievance — pending with the mentor.
  const s2b = ctxFor('usr_student_b', iso(base, -1));
  const grievance = createApplication(s2b, 'at_grievance', {
    subject: 'Marks not updated for the second internal assessment',
    details:
      'The second internal assessment marks are missing in the portal even after the re-evaluation request was submitted.',
    consent: true,
  });
  seedDocument(data, grievance.id, 'marksheet', 'internal-assessment-slip.pdf', 900, 'usr_student_b', iso(base, -1));
  submitApplication(s2b, grievance.id);

  // 7) Student C (section B) — bonafide request pending with the section-B mentor.
  const s3 = ctxFor('usr_student_c', iso(base, -3));
  const bonafideC = createApplication(s3, 'at_bonafide', {
    purpose: 'Required for a passport application.',
  });
  submitApplication(s3, bonafideC.id);

  // A draft, so the "draft" state is visible in the demo.
  createApplication(ctxFor('usr_student_c', iso(base, -0.5)), 'at_student_leave', {
    leave_type: 'Official duty',
    from_date: iso(base, 10).slice(0, 10),
    to_date: iso(base, 11).slice(0, 10),
    reason: 'Representing the college at the inter-university technical fest.',
  });

  // Mark the oldest notifications as read to exercise the read/unread badge.
  const s1Notifications = data.notifications.filter((n) => n.user_id === 'usr_student_a');
  for (const n of s1Notifications.slice(0, 2)) n.read_at = iso(base, -10);
  markNoticeRead(ctxFor('usr_student_a', nowIso), sectionNotice.id);

  data.audit.unshift({
    id: 'au_seed',
    actor_id: 'usr_sysadmin',
    actor_name: 'System Administrator',
    action: 'system.seed',
    entity: 'system',
    entity_id: null,
    meta: { note: 'Demo data created. Replace with real university data before production use.' },
    created_at: nowIso,
  });

  return data;
}
