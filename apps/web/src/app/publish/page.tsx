import { redirect } from "next/navigation";

/** Publishing lives in the owner's dashboard only. */
export default function PublishPage() {
  redirect("/admin#publish");
}
