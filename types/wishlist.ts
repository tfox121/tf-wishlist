export interface WishlistItem {
  Idea: string;
  Purchased: boolean;
  Link: string;
  Notes: string;
  Priority?: "HIGH" | "MEDIUM" | "LOW" | "";
}

