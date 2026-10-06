import type { ReactNode } from 'react';
import ProteccionMfa from '../componentes/ProteccionMfa';
export default function Layout({ children }: { children: ReactNode }) {
 return <ProteccionMfa>{children}</ProteccionMfa>;
}
