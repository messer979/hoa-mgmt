export type Role = "admin" | "member";
export type Choice = "affirm" | "reject" | "abstain";
export type VoteSource = "web" | "email" | "admin_proxy";
export type TopicStatus = "open" | "closed" | "passed" | "failed";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  unit_number: string | null;
  role: Role;
  created_at: string;
};

export type Topic = {
  id: string;
  title: string;
  description: string | null;
  status: TopicStatus;
  created_by: string | null;
  closes_at: string | null;
  created_at: string;
};

export type Vote = {
  id: string;
  topic_id: string;
  voter_id: string;
  choice: Choice;
  source: VoteSource;
  voted_by: string | null;
  email_id: string | null;
  notes: string | null;
  created_at: string;
};

export type EmailRow = {
  id: string;
  message_id: string | null;
  from_email: string;
  from_name: string | null;
  to_email: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  topic_id: string | null;
  matched_profile_id: string | null;
  processed: boolean;
  is_outbound: boolean;
  in_reply_to: string | null;
  references_ids: string[] | null;
  received_at: string;
};

export type TopicMessage = {
  id: string;
  topic_id: string;
  author_profile_id: string | null;
  author_email: string | null;
  author_name: string | null;
  body_text: string;
  body_html: string | null;
  source: "email" | "web";
  email_id: string | null;
  extracted: boolean;
  created_at: string;
};

export type Attachment = {
  id: string;
  email_id: string | null;
  topic_id: string | null;
  storage_path: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  received_at: string;
};
