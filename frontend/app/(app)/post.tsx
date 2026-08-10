import { useAuth } from "@/src/auth";
import CustomerPost from "@/src/screens/CustomerPost";
import DriverTrucks from "@/src/screens/DriverTrucks";

export default function PostOrTrucks() {
  const { user } = useAuth();
  if (user?.role === "driver") return <DriverTrucks />;
  return <CustomerPost />;
}
