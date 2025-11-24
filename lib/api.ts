import type { WishlistItem } from "@/types/wishlist";

const API_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbyQanPSTtczRcihT5vhg04RpFIRav-asSdUOWAnPxbN1v1jNMFBW1VUHHLmM0X5Id3H/exec";

export async function fetchWishlistItems(): Promise<WishlistItem[]> {
  const response = await fetch(API_ENDPOINT, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch wishlist items");
  }

  return response.json();
}

export async function updateItemPurchased(
  itemIndex: number,
  purchased: boolean
): Promise<void> {
  // Google Apps Script web apps sometimes have issues with POST requests
  // Try using form data (URL-encoded) which is more compatible
  const formData = new URLSearchParams();
  formData.append("index", itemIndex.toString());
  formData.append("purchased", purchased.toString());

  try {
    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      // If POST fails with 405, try using GET with parameters as fallback
      if (response.status === 405) {
        const getUrl = new URL(API_ENDPOINT);
        getUrl.searchParams.append("index", itemIndex.toString());
        getUrl.searchParams.append("purchased", purchased.toString());
        getUrl.searchParams.append("method", "update");
        
        const getResponse = await fetch(getUrl.toString(), {
          method: "GET",
        });
        
        if (!getResponse.ok) {
          throw new Error(`Failed to update item: ${getResponse.status}`);
        }
        return;
      }
      throw new Error(`Failed to update item: ${response.status}`);
    }

    try {
      const result = await response.json();
      if (result.error) {
        throw new Error(result.error);
      }
    } catch (e) {
      // If response isn't JSON, that's okay - the update might have still worked
      console.warn("Could not parse response as JSON, but request may have succeeded");
    }
  } catch (error) {
    console.error("Error updating item:", error);
    throw error;
  }
}

