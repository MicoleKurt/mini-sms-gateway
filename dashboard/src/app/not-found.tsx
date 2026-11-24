import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="page">
      <div className="sec">
        <p className="lbl">
          Not found <span className="num text-ink-3">404</span>
        </p>
        <div className="sec-b">
          <h1 className="headline">There is nothing at this address.</h1>
          <Link href="/" className={buttonClasses({ variant: "secondary", className: "mt-6" })}>
            Go to the overview
          </Link>
        </div>
      </div>
    </main>
  );
}
