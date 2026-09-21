import { Outlet, Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Chatbot from './Chatbot'
import { 
  Layout as LayoutIcon, Users, UserCheck, Package, 
  FileText, Megaphone, Warehouse, LogOut, ClipboardList, Bot, Sprout 
} from 'lucide-react'

const Layout = () => {
  const { user, logout } = useAuth()
  const location = useLocation()

  // Build navigation dynamically based on role
  let navigation = []

  if (user?.role === 'ADMIN') {
    navigation = [
      { name: 'Dashboard', href: '/', icon: LayoutIcon },
      { name: 'Staff Management', href: '/staff', icon: UserCheck },
      { name: 'Farmers Directory', href: '/farmers', icon: Users },
      { name: 'Gov Schemes', href: '/schemes', icon: FileText },
      { name: 'Soil Suitability', href: '/soil-suitability', icon: Sprout },
      { name: 'Announcements', href: '/announcements', icon: Megaphone },
      { name: 'Warehouse IoT', href: '/warehouse', icon: Warehouse },
      { name: 'AI Assistant', href: '/chatbot-settings', icon: Bot },
      { name: 'Service Requests', href: '/service-requests', icon: ClipboardList },
    ]
  } else if (user?.role === 'STAFF') {
    navigation = [
      { name: 'Dashboard', href: '/', icon: LayoutIcon },
      { name: 'Farmers Registry', href: '/farmers', icon: Users },
      { name: 'Inventory & Dist', href: '/inventory', icon: Package },
      { name: 'Gov Schemes', href: '/schemes', icon: FileText },
      { name: 'Soil Suitability', href: '/soil-suitability', icon: Sprout },
      { name: 'Service Requests', href: '/service-requests', icon: ClipboardList },
      { name: 'Warehouse Entry', href: '/warehouse', icon: Warehouse },
      { name: 'AI Assistant', href: '/chatbot-settings', icon: Bot },
    ]
  } else if (user?.role === 'FARMER') {
    navigation = [
      { name: 'Dashboard', href: '/', icon: LayoutIcon },
      { name: 'Soil Suitability', href: '/soil-suitability', icon: Sprout },
      { name: 'Eligible Schemes', href: '/schemes', icon: FileText },
      { name: 'Announcements', href: '/announcements', icon: Megaphone },
      { name: 'Service Requests', href: '/service-requests', icon: ClipboardList },
      { name: 'AI Assistant', href: '/chatbot-settings', icon: Bot },
    ]
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <nav className="bg-white shadow-sm border-b border-gray-250 shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <span className="text-lg font-black bg-gradient-to-r from-primary-600 to-primary-700 bg-clip-text text-transparent uppercase tracking-wider">
                  Smart Coop
                </span>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-4">
                {navigation.map((item) => {
                  const Icon = item.icon
                  const active = location.pathname === item.href
                  return (
                    <Link
                      key={item.name}
                      to={item.href}
                      className={`inline-flex items-center px-3 pt-1 border-b-2 text-sm font-semibold transition-all ${
                        active
                          ? 'border-primary-500 text-primary-600 font-extrabold'
                          : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                      }`}
                    >
                      <Icon className="w-4 h-4 mr-1.5" />
                      {item.name}
                    </Link>
                  )
                })}
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <div className="hidden md:flex flex-col text-right">
                <span className="text-xs text-gray-400 font-bold uppercase">{user?.role}</span>
                <span className="text-sm font-extrabold text-gray-800">{user?.name}</span>
              </div>
              <div className="w-8 h-8 rounded-full bg-primary-50 text-primary-700 border border-primary-250 flex items-center justify-center font-bold text-sm">
                {user?.name?.charAt(0) || 'U'}
              </div>
              <button
                onClick={logout}
                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                title="Sign Out"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 flex-1">
        <Outlet />
      </main>
      <Chatbot />
    </div>
  )
}

export default Layout
