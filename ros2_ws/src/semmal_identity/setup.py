from setuptools import setup

package_name = 'semmal_identity'

setup(
    name=package_name,
    version='0.1.0',
    packages=[package_name],
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='semmal',
    maintainer_email='cvineetjonathan@gmail.com',
    description='Robot identity facts for the device identity service.',
    license='Apache-2.0',
    entry_points={'console_scripts': ['identity_node = semmal_identity.identity_node:main']},
)
