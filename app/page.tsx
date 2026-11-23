"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWishlistItems, updateItemPurchased } from "@/lib/api";
import type { WishlistItem } from "@/types/wishlist";
import { useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";

type Tab = "wishlist" | "purchased";
type ShoppingLink = {
  href: string;
  destination: "Google" | "Amazon";
  item?: WishlistItem;
};

const shoppingReminderKey = "wishlist-shopping-reminder-acknowledged";
const sourceLinkClassName = "break-all text-blue-600 underline hover:text-blue-800";
const priorityRanks = new Map<string, number>([
  ["HIGH", 0],
  ["MEDIUM", 1],
  ["LOW", 2],
]);

function getPriorityRank({ Priority }: WishlistItem) {
  return priorityRanks.get(Priority ?? "") ?? priorityRanks.size;
}

function shuffleRowIndexes(rowCount: number) {
  const indexes = Array.from({ length: rowCount }, (_, index) => index);
  for (let i = indexes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  return indexes;
}

function getSourceLinkUrl(value: string) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^(?:https?:\/\/|www\.)/i.test(text)) return null;

  try {
    return new URL(/^www\./i.test(text) ? `https://${text}` : text).href;
  } catch {
    return null;
  }
}

function renderNotes(notes: string, onShoppingLink: (event: MouseEvent<HTMLAnchorElement>) => void) {
  const parts: ReactNode[] = [];
  let offset = 0;

  for (const match of notes.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"“”]+/gi)) {
    const candidate = match[0];
    let label = candidate.replace(/[.,!?;:]+$/, "");
    if (label.endsWith(")") && label.split(")").length > label.split("(").length) {
      label = label.slice(0, -1);
    }

    const href = getSourceLinkUrl(label);
    if (!href) continue;

    parts.push(notes.slice(offset, match.index));
    parts.push(
      <a
        key={match.index}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onShoppingLink}
        onAuxClick={onShoppingLink}
        className={sourceLinkClassName}
      >
        {label}
      </a>,
    );
    offset = match.index + label.length;
  }

  parts.push(notes.slice(offset));
  return parts;
}

function hasAcknowledgedShoppingReminder() {
  try {
    return window.localStorage.getItem(shoppingReminderKey) === "true";
  } catch {
    return false;
  }
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("wishlist");
  const [shoppingLink, setShoppingLink] = useState<ShoppingLink | null>(null);
  const shoppingDialog = useRef<HTMLDialogElement>(null);
  const acknowledgedShoppingReminder = useRef(false);
  const queryClient = useQueryClient();

  function handleShoppingLink(event: MouseEvent<HTMLAnchorElement>, item?: WishlistItem) {
    if (event.button > 1 || acknowledgedShoppingReminder.current) return;

    const { href, hostname } = event.currentTarget;
    const retailer = hostname.match(/(?:^|\.)(google|amazon)\.(?:[a-z]{2,3}|(?:co|com)\.[a-z]{2})$/i)?.[1];
    if (!retailer || hasAcknowledgedShoppingReminder()) return;

    event.preventDefault();
    setShoppingLink({ href, destination: retailer === "google" ? "Google" : "Amazon", item });
    shoppingDialog.current?.showModal();
  }

  function continueToShoppingLink(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button > 1) return;

    acknowledgedShoppingReminder.current = true;
    try {
      window.localStorage.setItem(shoppingReminderKey, "true");
    } catch {
      // The in-memory acknowledgement still applies if browser storage is unavailable.
    }
    shoppingDialog.current?.close();
  }

  const { data: items = [], isLoading, error } = useQuery({
    queryKey: ["wishlist"],
    queryFn: fetchWishlistItems,
  });

  const updateMutation = useMutation({
    mutationFn: ({ index, purchased }: { index: number; purchased: boolean }) =>
      updateItemPurchased(index, purchased),
    // Optimistic update: immediately update the UI
    onMutate: async ({ index, purchased }) => {
      // Cancel any outgoing refetches to avoid overwriting our optimistic update
      await queryClient.cancelQueries({ queryKey: ["wishlist"] });

      // Snapshot the previous value for rollback
      const previousItems = queryClient.getQueryData<WishlistItem[]>(["wishlist"]);

      // Optimistically update the cache
      if (previousItems) {
        const updatedItems = [...previousItems];
        if (updatedItems[index]) {
          updatedItems[index] = { ...updatedItems[index], Purchased: purchased };
        }
        queryClient.setQueryData<WishlistItem[]>(["wishlist"], updatedItems);
      }

      // Return context with the previous value for rollback
      return { previousItems };
    },
    // On error, rollback to the previous state
    onError: (err, variables, context) => {
      if (context?.previousItems) {
        queryClient.setQueryData(["wishlist"], context.previousItems);
      }
    },
    // On success or error, refetch to ensure we're in sync with the backend
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["wishlist"] });
    },
  });

  const handleMarkPurchased = (index: number) => {
    updateMutation.mutate({ index, purchased: true });
  };

  const handleMarkUnpurchased = (index: number) => {
    updateMutation.mutate({ index, purchased: false });
  };

  const rowCount = items.length;
  const shuffledIndexes = useMemo(() => shuffleRowIndexes(rowCount), [rowCount]);
  const filteredItems = useMemo(() => {
    const showPurchased = activeTab === "purchased";
    // A stable sort preserves the shuffled order among rows with the same priority.
    return shuffledIndexes
      .map((index) => ({ item: items[index], index }))
      .filter(({ item }) => Boolean(item.Purchased) === showPurchased)
      .sort((a, b) => getPriorityRank(a.item) - getPriorityRank(b.item));
  }, [items, activeTab, shuffledIndexes]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading wishlist...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-red-600">Error loading wishlist. Please try again.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Tom's Wishlist</h1>

        {/* Explanation */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
          <p className="text-sm text-blue-900 mb-3">
            <strong>For visitors:</strong> Feel free to mark off any items you intend to purchase or have already purchased. 
            This helps avoid duplicate gifts!
          </p>
          <a
            href="https://www.amazon.ca/hz/wishlist/ls/3KL70QY8FQF60?ref_=wl_share"
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleShoppingLink}
            onAuxClick={handleShoppingLink}
            className="inline-flex items-center text-sm font-medium text-blue-700 hover:text-blue-800 underline"
          >
            View on Amazon →
          </a>
        </div>

        {/* Warning for non-Canadian visitors */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-8">
          <p className="text-sm text-amber-900">
            <strong>⚠️ Important for non-Canadian visitors:</strong> Please do not send battery-powered items or liquids by post due to shipping restrictions. 
            If you're purchasing from outside Canada, please use Amazon.ca or choose items that don't contain batteries or liquids.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex space-x-4 mb-6 border-b border-gray-200">
          <button
            onClick={() => setActiveTab("wishlist")}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === "wishlist"
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Wishlist ({items.filter((item) => !item.Purchased).length})
          </button>
          <button
            onClick={() => setActiveTab("purchased")}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === "purchased"
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Already Purchased ({items.filter((item) => item.Purchased).length})
          </button>
        </div>

        {/* Items List */}
        <div className="space-y-4">
          {filteredItems.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              {activeTab === "wishlist"
                ? "No items in your wishlist yet."
                : "No purchased items yet."}
            </div>
          ) : (
            filteredItems.map(({ item, index }) => (
              <WishlistItemCard
                key={`${item.Idea}-${index}`}
                item={item}
                index={index}
                onMarkPurchased={handleMarkPurchased}
                onMarkUnpurchased={handleMarkUnpurchased}
                onShoppingLink={handleShoppingLink}
                showPurchaseButton={activeTab === "wishlist" && !item.Purchased}
                showUnpurchaseButton={activeTab === "purchased" && item.Purchased}
              />
            ))
          )}
        </div>
      </div>

      <dialog
        ref={shoppingDialog}
        aria-labelledby="shopping-reminder-title"
        aria-describedby="shopping-reminder-message"
        className="m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-xl border border-gray-200 bg-white p-6 text-gray-900 shadow-xl backdrop:bg-gray-900/50"
      >
        <h2 id="shopping-reminder-title" className="text-xl font-semibold">
          Double-check before you order
        </h2>
        <p id="shopping-reminder-message" className="mt-3 text-sm leading-relaxed text-gray-700">
          Amazon and Google may show similar products, especially when the requested item
          is out of stock. Before ordering, check that the product matches the wishlist description.
          Don't just buy the first 'Sponsered' Amazon item!
        </p>
        {shoppingLink?.item && (
          <div className="mt-4 break-words rounded-md bg-gray-100 p-3 text-sm">
            <p className="font-semibold">{shoppingLink.item.Idea}</p>
            {shoppingLink.item.Notes && (
              <p className="mt-1 whitespace-pre-line text-gray-700">{shoppingLink.item.Notes}</p>
            )}
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={() => shoppingDialog.current?.close()}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Back to wishlist
          </button>
          {shoppingLink && (
            <a
              href={shoppingLink.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={continueToShoppingLink}
              onAuxClick={continueToShoppingLink}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Continue to {shoppingLink.destination}
            </a>
          )}
        </div>
      </dialog>
    </div>
  );
}

interface WishlistItemCardProps {
  item: WishlistItem;
  index: number;
  onMarkPurchased: (index: number) => void;
  onMarkUnpurchased: (index: number) => void;
  onShoppingLink: (event: MouseEvent<HTMLAnchorElement>, item: WishlistItem) => void;
  showPurchaseButton: boolean;
  showUnpurchaseButton: boolean;
}

function WishlistItemCard({
  item,
  index,
  onMarkPurchased,
  onMarkUnpurchased,
  onShoppingLink,
  showPurchaseButton,
  showUnpurchaseButton,
}: WishlistItemCardProps) {
  const handleShoppingLink = (event: MouseEvent<HTMLAnchorElement>) => onShoppingLink(event, item);
  const sourceLink = item.Link ? getSourceLinkUrl(item.Link) : null;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
      <div className="flex flex-col md:flex-row md:justify-between md:items-start">
        <div className="flex-1 mb-4 md:mb-0">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-lg font-semibold text-gray-900">{item.Idea}</h3>
            <a
              href={`https://www.google.com/search?q=${encodeURIComponent(item.Idea)}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleShoppingLink}
              onAuxClick={handleShoppingLink}
              className="text-gray-500 hover:text-gray-700 transition-colors"
              aria-label="Search on Google"
              title="Search on Google"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </a>
            <a
              href={`https://www.amazon.ca/s?k=${encodeURIComponent(item.Idea)}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleShoppingLink}
              onAuxClick={handleShoppingLink}
              className="text-gray-500 hover:text-orange-600 transition-colors"
              aria-label="Search on Amazon.ca"
              title="Search on Amazon.ca"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </a>
          </div>
          {item.Notes && (
            <p className="mb-3 whitespace-pre-line text-sm text-gray-600">
              {renderNotes(String(item.Notes), handleShoppingLink)}
            </p>
          )}
          {sourceLink && (
            <a
              href={sourceLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleShoppingLink}
              onAuxClick={handleShoppingLink}
              className={`text-sm ${sourceLinkClassName}`}
            >
              View Link
            </a>
          )}
        </div>
        {/* Desktop: button on the right */}
        <div className="hidden md:flex md:items-center md:gap-2 md:ml-4">
          {showPurchaseButton && (
            <button
              onClick={() => onMarkPurchased(index)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors whitespace-nowrap"
            >
              Mark as Purchased
            </button>
          )}
          {showUnpurchaseButton && (
            <button
              onClick={() => onMarkUnpurchased(index)}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors whitespace-nowrap"
            >
              Mark as Unpurchased
            </button>
          )}
          {!showPurchaseButton && !showUnpurchaseButton && (
            <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium whitespace-nowrap">
              Purchased
            </span>
          )}
        </div>
        {/* Mobile: button at the bottom */}
        <div className="flex md:hidden items-center gap-2 mt-2">
          {showPurchaseButton && (
            <button
              onClick={() => onMarkPurchased(index)}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Mark as Purchased
            </button>
          )}
          {showUnpurchaseButton && (
            <button
              onClick={() => onMarkUnpurchased(index)}
              className="w-full px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
            >
              Mark as Unpurchased
            </button>
          )}
          {!showPurchaseButton && !showUnpurchaseButton && (
            <span className="w-full text-center px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
              Purchased
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

