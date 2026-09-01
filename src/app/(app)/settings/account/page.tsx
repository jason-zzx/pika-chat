import ChangePasswordForm from "@/components/account/ChangePasswordForm";
import PageHeader from "@/components/layout/PageHeader";

export default function SettingsAccountPage() {
  return (
    <>
      <PageHeader title="Account" description="Change your password." />
      <ChangePasswordForm />
    </>
  );
}
