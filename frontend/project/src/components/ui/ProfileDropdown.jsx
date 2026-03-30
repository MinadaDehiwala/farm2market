import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import "../../styles/components/profile-dropdown.css";

export default function ProfileDropdown({
  trigger,
  onViewProfile,
  onAdmin,
  onLogout,
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        {trigger}
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="profile-dropdown glass"
          sideOffset={8}
          align="center"
        >
          <DropdownMenu.Item
            className="dropdown-item"
            onSelect={onViewProfile}
          >
            View Profile
          </DropdownMenu.Item>

          {typeof onAdmin === "function" && (
            <DropdownMenu.Item
              className="dropdown-item"
              onSelect={onAdmin}
            >
              Admin Center
            </DropdownMenu.Item>
          )}

          <DropdownMenu.Separator className="dropdown-separator" />

          <DropdownMenu.Item
            className="dropdown-item danger"
            onSelect={onLogout}
          >
            Logout
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
