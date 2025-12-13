import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

interface BackButtonProps {
  to?: string;
  className?: string;
}

export function BackButton({ to = "/", className = "" }: BackButtonProps) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(to)}
      className={`text-zinc-400 hover:text-zinc-100 transition-all duration-200 hover:scale-105 text-sm md:text-md border border-zinc-700 rounded-md px-3 py-1.5 hover ${className}`}
    >
      <ArrowLeft className="w-4 h-4" />
    </button>
  );
}