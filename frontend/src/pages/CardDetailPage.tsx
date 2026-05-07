import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

/**
 * Legacy /cards/:id route — redirects to the inline library detail view
 * (`/?card=<id>`). Kept so old bookmarks and external links still resolve.
 */
export default function CardDetailPage() {
  const { cardId = "" } = useParams<{ cardId: string }>();
  const navigate = useNavigate();
  useEffect(() => {
    navigate(cardId ? `/?card=${cardId}` : "/", { replace: true });
  }, [cardId, navigate]);
  return null;
}
