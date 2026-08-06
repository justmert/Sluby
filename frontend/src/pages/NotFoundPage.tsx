import { Link } from 'react-router-dom';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFoundPage() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-10 max-w-md w-full text-center backdrop-blur-sm">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center mb-6">
          <FileQuestion className="w-8 h-8 text-zinc-500" />
        </div>
        <h1 className="text-2xl font-semibold text-[#f0f0f0] font-heading tracking-tight mb-2">
          Page not found
        </h1>
        <p className="text-sm text-zinc-400 mb-6">
          The page you are looking for does not exist or has been moved.
        </p>
        <Button
          asChild
          className="bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-lg"
        >
          <Link to="/studio" className="gap-2">
            Back to Dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}
