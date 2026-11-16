import { PageHeader } from '../components/ui/PageHeader'
import { ProfileSecuritySection } from '../components/auth/ProfileSecuritySection'

export default function ProfilePage() {
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <PageHeader
        title="My Profile & Security"
        subtitle="Update your display name and rotate your account password"
      />
      <ProfileSecuritySection />
    </div>
  )
}

