export type Voter = {
  id: number;
  full_name: string;
  national_id: string;
  status: 0 | 1;
  voted_at: string | null;
  area: string | null;
  created_at?: string;
  updated_at?: string;
  batch_id?: number | null;
  /** رقم الصف (#) من ملف Excel */
  list_number?: number | null;
};

export type DashboardStats = {
  total: number;
  voted: number;
  pending: number;
  percentVoted: number;
  byArea: { area: string; total: number; voted: number; pending: number; percent: number }[];
  byFamily: { family: string; voted: number; percent: number }[];
  /** عند عرض «الكل» — إحصائيات لكل دفعة Excel (مدرسة / ملف) */
  byBatch?: {
    batchId: number;
    title: string;
    total: number;
    voted: number;
    pending: number;
    percent: number;
  }[] | null;
  batchId?: number | null;
  /** عند اختيار دفعة في النطاق — اسم المدرسة/الدفعة من الخادم */
  batchTitle?: string | null;
};

export type AuditLog = {
  id: number;
  user_id: number;
  username: string;
  action: string;
  entity: string;
  entity_id: string | null;
  details: unknown;
  created_at: string;
};
