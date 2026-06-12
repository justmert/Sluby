import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function PageContainer({ children, className }: PageContainerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={cn('max-w-7xl mx-auto px-8 py-8', className)}
    >
      {children}
    </motion.div>
  );
}
