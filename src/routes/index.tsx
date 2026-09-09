import { createFileRoute } from "@tanstack/react-router";
import { MinhocaApp } from "@/components/minhoca/MinhocaApp";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <MinhocaApp />;
}
