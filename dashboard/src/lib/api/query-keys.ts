export const queryKeys = {
  tenants: ["tenants"] as const,
  prices: ["prices"] as const,
  overview: ["overview"] as const,
  messageLists: ["messages", "list"] as const,
  messageList: (filters: object) => ["messages", "list", filters] as const,
  messageDetail: (id: string) => ["messages", "detail", id] as const,
};
